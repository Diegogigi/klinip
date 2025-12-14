from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from jose import jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from . import models
from .database import SessionLocal

SECRET_KEY = "supersecretkey_change_me"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

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
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.email == email).first()


def authenticate_user(db: Session, email: str, password: str) -> Optional[models.User]:
    user = get_user_by_email(db, email)
    if not user:
        print(f"DEBUG: Usuario no encontrado para email: {email}")
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
        detail="No se pudo validar las credenciales",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    print(f"DEBUG get_current_user: Token recibido: {token[:20]}..." if token else "DEBUG: No token recibido")
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        print(f"DEBUG get_current_user: Payload decodificado: {payload}")
        user_id = payload.get("sub")
        print(f"DEBUG get_current_user: User ID del token: {user_id}, tipo: {type(user_id)}")
        
        if user_id is None:
            print("DEBUG get_current_user: user_id es None en payload")
            raise credentials_exception
        
        # Asegurar que user_id sea int
        if isinstance(user_id, str):
            user_id = int(user_id)
            
    except jwt.ExpiredSignatureError:
        print("DEBUG get_current_user: Token expirado")
        raise credentials_exception
    except jwt.JWTError as e:
        print(f"DEBUG get_current_user: Error JWT: {str(e)}")
        raise credentials_exception
    except Exception as e:
        print(f"DEBUG get_current_user: Error inesperado: {str(e)}")
        raise credentials_exception
    
    user = db.query(models.User).filter(models.User.id == user_id).first()
    print(f"DEBUG get_current_user: Usuario encontrado: {user.email if user else 'None'}")
    
    if user is None:
        print(f"DEBUG get_current_user: Usuario con ID {user_id} no existe en BD")
        raise credentials_exception
    
    return user
