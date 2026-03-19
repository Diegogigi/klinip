from datetime import datetime, timedelta
from typing import Optional, List
import base64
import hashlib
import json
import os
import secrets

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from jose import jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from . import models
from .database import SessionLocal

# Obtener SECRET_KEY de variables de entorno, con fallback para desarrollo
SECRET_KEY = os.getenv("SECRET_KEY", "supersecretkey_change_me_in_production")
ALGORITHM = "HS256"
# Access token corto (15 min); el cliente usa refresh token para renovar
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))
# Token temporal MFA: 5 minutos para completar el segundo paso
MFA_TOKEN_EXPIRE_MINUTES = 5
# Step-up token: 10 minutos para completar una acción sensible
STEPUP_TOKEN_EXPIRE_MINUTES = 10
# Field encryption key for sensitive DB fields (MFA secret, etc.)
# Must be a 32-byte URL-safe base64 key. Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
FIELD_ENCRYPTION_KEY = os.getenv("FIELD_ENCRYPTION_KEY", "")

# Validar que SECRET_KEY no sea el valor por defecto en producción
if os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_PUBLIC_DOMAIN"):
    if SECRET_KEY == "supersecretkey_change_me_in_production":
        print("⚠️ ADVERTENCIA: SECRET_KEY no está configurado. La autenticación puede fallar.")
        print("⚠️ Por favor, configura la variable de entorno SECRET_KEY en Railway.")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False


def hash_token(raw: str) -> str:
    """SHA-256 del token en crudo; usado para refresh tokens y backup codes."""
    return hashlib.sha256(raw.encode()).hexdigest()


# ─── Access token ─────────────────────────────────────────────────────────────

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": int(expire.timestamp()), "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# ─── MFA temp token ───────────────────────────────────────────────────────────

def create_mfa_temp_token(user_id: int, token_version: int) -> str:
    """Token de corta duración para el paso 2 del login con MFA."""
    expire = datetime.utcnow() + timedelta(minutes=MFA_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "tv": token_version,
        "type": "mfa_pending",
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_mfa_temp_token(token: str) -> Optional[dict]:
    """Decodifica el MFA temp token; retorna None si es inválido."""
    try:
        from fastapi import HTTPException, status
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "mfa_pending":
            return None
        return payload
    except Exception:
        return None


# ─── Refresh tokens ───────────────────────────────────────────────────────────

def create_refresh_token(
    db: Session,
    user_id: int,
    ip_address: str = "",
    device_label: str = "",
) -> str:
    """Genera un refresh token, lo almacena (hasheado) y devuelve el raw token."""
    raw = secrets.token_urlsafe(48)
    token_hash = hash_token(raw)
    expires_at = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    rt = models.RefreshToken(
        user_id=user_id,
        token_hash=token_hash,
        ip_address=ip_address,
        device_label=device_label[:200],
        expires_at=expires_at,
    )
    db.add(rt)
    db.commit()
    return raw


def rotate_refresh_token(
    db: Session,
    old_raw: str,
    ip_address: str = "",
    device_label: str = "",
) -> Optional[tuple]:
    """
    Valida el refresh token entrante; si es válido:
    - Lo revoca
    - Crea uno nuevo
    - Devuelve (nuevo_raw, user_id)
    Si detecta reutilización (ya revocado) revoca todos los tokens del usuario.
    """
    old_hash = hash_token(old_raw)
    rt = db.query(models.RefreshToken).filter(
        models.RefreshToken.token_hash == old_hash
    ).first()

    if rt is None:
        return None  # Token desconocido

    if rt.revoked:
        # Posible robo de token: revocar todos los del usuario
        db.query(models.RefreshToken).filter(
            models.RefreshToken.user_id == rt.user_id,
            models.RefreshToken.revoked.is_(False),
        ).update({"revoked": True})
        db.commit()
        return None

    if rt.expires_at < datetime.utcnow():
        rt.revoked = True
        db.add(rt)
        db.commit()
        return None

    user_id = rt.user_id
    rt.revoked = True
    db.add(rt)
    db.commit()

    new_raw = create_refresh_token(db, user_id, ip_address, device_label)
    return new_raw, user_id


def revoke_all_refresh_tokens(db: Session, user_id: int) -> int:
    """Revoca todas las sesiones activas del usuario. Devuelve el número revocado."""
    n = db.query(models.RefreshToken).filter(
        models.RefreshToken.user_id == user_id,
        models.RefreshToken.revoked.is_(False),
    ).update({"revoked": True})
    db.commit()
    return n


# ─── MFA / TOTP ───────────────────────────────────────────────────────────────

def generate_totp_secret() -> str:
    try:
        import pyotp
        return pyotp.random_base32()
    except ImportError:
        # Fallback si pyotp no está instalado (no debería ocurrir en prod)
        import base64
        return base64.b32encode(secrets.token_bytes(20)).decode()


def get_totp_uri(stored_secret: str, email: str, issuer: str = "Klinip") -> str:
    secret = decrypt_field(stored_secret)
    try:
        import pyotp
        return pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)
    except ImportError:
        return f"otpauth://totp/{issuer}:{email}?secret={secret}&issuer={issuer}"


def verify_totp(stored_secret: str, code: str) -> bool:
    if not stored_secret:
        return False
    secret = decrypt_field(stored_secret)
    try:
        import pyotp
        totp = pyotp.TOTP(secret)
        # valid_window=1 acepta el código anterior y el siguiente (30s cada ventana)
        return totp.verify(code.strip(), valid_window=1)
    except Exception:
        return False


def generate_backup_codes(count: int = 10) -> List[str]:
    """Genera códigos de respaldo en texto plano (solo se muestran una vez)."""
    return [secrets.token_hex(5).upper() for _ in range(count)]


def hash_backup_codes(codes: List[str]) -> str:
    """Serializa la lista de hashes de backup codes como JSON."""
    return json.dumps([hash_token(c) for c in codes])


def verify_backup_code(stored_json: str, code: str) -> Optional[str]:
    """
    Verifica un código de respaldo. Si es válido, devuelve el JSON actualizado
    sin ese código (consumido). Si es inválido, devuelve None.
    """
    try:
        codes: List[str] = json.loads(stored_json)
    except Exception:
        return None
    code_hash = hash_token(code.strip().upper())
    if code_hash in codes:
        codes.remove(code_hash)
        return json.dumps(codes)
    return None


# ─── Step-up authentication ───────────────────────────────────────────────────

def create_stepup_token(user_id: int) -> str:
    """Token de corta duración que acredita que el usuario acaba de autenticarse
    con MFA o contraseña para una acción sensible."""
    expire = datetime.utcnow() + timedelta(minutes=STEPUP_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "type": "stepup",
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_stepup_token(token: str, user_id: int) -> bool:
    """Verifica que el step-up token sea válido y corresponda al usuario."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return (
            payload.get("type") == "stepup"
            and int(payload.get("sub", -1)) == user_id
        )
    except Exception:
        return False


# ─── Field encryption (MFA secret at rest) ────────────────────────────────────

_FERNET = None

def _get_fernet():
    global _FERNET
    if _FERNET is not None:
        return _FERNET
    if not FIELD_ENCRYPTION_KEY:
        return None
    try:
        from cryptography.fernet import Fernet
        _FERNET = Fernet(FIELD_ENCRYPTION_KEY.encode() if isinstance(FIELD_ENCRYPTION_KEY, str) else FIELD_ENCRYPTION_KEY)
        return _FERNET
    except Exception:
        return None


def encrypt_field(value: str) -> str:
    """Cifra un valor de campo sensible. Prefija con 'enc:' para identificarlo."""
    fernet = _get_fernet()
    if not fernet:
        return value  # sin clave = sin cifrado (development fallback)
    encrypted = fernet.encrypt(value.encode()).decode()
    return f"enc:{encrypted}"


def decrypt_field(value: str) -> str:
    """Descifra un campo cifrado. Soporta valores legados sin cifrar."""
    if not value or not value.startswith("enc:"):
        return value  # valor legado o sin cifrar
    fernet = _get_fernet()
    if not fernet:
        return value.removeprefix("enc:")  # degraded: devolver sin descifrar
    try:
        return fernet.decrypt(value[4:].encode()).decode()
    except Exception:
        return ""  # descifrado fallido


# ─── Usuarios ─────────────────────────────────────────────────────────────────

def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.email == email).first()


def authenticate_user(db: Session, email: str, password: str) -> Optional[models.User]:
    user = get_user_by_email(db, email)
    if not user:
        return None
    if getattr(user, "deleted", False):
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> models.User:
    """Obtiene el usuario actual a partir del access token JWT."""
    from fastapi import HTTPException, status

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado. Por favor, inicia sesión nuevamente.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        # Rechazar tokens que no sean access tokens (p.ej. mfa_pending)
        if payload.get("type") not in ("access", None):
            raise credentials_exception
        user_id = payload.get("sub")
        token_version = payload.get("tv")

        if user_id is None or token_version is None:
            raise credentials_exception

        if isinstance(user_id, str):
            user_id = int(user_id)
        if isinstance(token_version, str):
            token_version = int(token_version)

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expirado. Por favor, inicia sesión nuevamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.JWTError:
        raise credentials_exception
    except Exception:
        raise credentials_exception

    user = db.query(models.User).filter(models.User.id == user_id).first()

    if user is None:
        raise credentials_exception

    current_token_version = int(getattr(user, "token_version", 0) or 0)
    if int(token_version) != current_token_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesion expirada. Por seguridad, inicia sesion nuevamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if getattr(user, "deleted", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Cuenta eliminada. Por favor, crea una nueva cuenta.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user
