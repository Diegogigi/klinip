from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from jose import jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from . import models
from .database import SessionLocal
import os

# Obtener SECRET_KEY de variables de entorno, con fallback para desarrollo
SECRET_KEY = os.getenv("SECRET_KEY", "supersecretkey_change_me_in_production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))  # 24 horas por defecto

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
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    # Convertir datetime a timestamp (int) para JWT
    to_encode.update({"exp": int(expire.timestamp())})
    print(f"DEBUG create_access_token: SECRET_KEY configurado: {'Sí' if SECRET_KEY != 'supersecretkey_change_me_in_production' else 'NO (usando valor por defecto)'}")
    print(f"DEBUG create_access_token: Token expira en: {expire} (timestamp: {to_encode['exp']})")
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.email == email).first()


def authenticate_user(db: Session, email: str, password: str) -> Optional[models.User]:
    user = get_user_by_email(db, email)
    if not user:
        print(f"DEBUG: Usuario no encontrado para email: {email}")
        return None
    if getattr(user, "deleted", False):
        print(f"DEBUG: Usuario eliminado para email: {email}")
        return None
    print(f"DEBUG: Usuario encontrado: {user.email}, verificando contraseña...")
    is_valid = verify_password(password, user.password_hash)
    print(f"DEBUG: Contraseña válida: {is_valid}")
    if not is_valid:
        print(f"DEBUG: Contraseña incorrecta para usuario: {user.email}")
        return None
    return user


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> models.User:
    """Obtiene el usuario actual a partir del token JWT."""
    from fastapi import HTTPException, status
    
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado. Por favor, inicia sesión nuevamente.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    print(f"DEBUG get_current_user: Token recibido: {token[:20]}..." if token else "DEBUG: No token recibido")
    print(f"DEBUG get_current_user: SECRET_KEY configurado: {'Sí' if SECRET_KEY != 'supersecretkey_change_me_in_production' else 'NO (usando valor por defecto)'}")
    print(f"DEBUG get_current_user: SECRET_KEY longitud: {len(SECRET_KEY)} caracteres")
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        print(f"DEBUG get_current_user: Payload decodificado: {payload}")
        user_id = payload.get("sub")
        token_version = payload.get("tv")
        print(f"DEBUG get_current_user: User ID del token: {user_id}, tipo: {type(user_id)}")
        
        if user_id is None:
            print("DEBUG get_current_user: user_id es None en payload")
            raise credentials_exception

        if token_version is None:
            print("DEBUG get_current_user: token_version ausente en payload")
            raise credentials_exception
        
        # Asegurar que user_id sea int
        if isinstance(user_id, str):
            user_id = int(user_id)
        if isinstance(token_version, str):
            token_version = int(token_version)
            
    except jwt.ExpiredSignatureError:
        print("DEBUG get_current_user: Token expirado")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expirado. Por favor, inicia sesión nuevamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.JWTError as e:
        print(f"DEBUG get_current_user: Error JWT: {str(e)}")
        # Si el error es por clave inválida, dar un mensaje más específico
        if "Invalid" in str(e) or "signature" in str(e).lower():
            print("⚠️ ERROR: El token no pudo ser validado. Verifica que SECRET_KEY esté configurado correctamente.")
        raise credentials_exception
    except Exception as e:
        print(f"DEBUG get_current_user: Error inesperado: {str(e)}")
        raise credentials_exception
    
    user = db.query(models.User).filter(models.User.id == user_id).first()
    print(f"DEBUG get_current_user: Usuario encontrado: {user.email if user else 'None'}")

    if user is None:
        print(f"DEBUG get_current_user: Usuario con ID {user_id} no existe en BD")
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
