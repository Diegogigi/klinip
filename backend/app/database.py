import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

DATABASE_URL = os.getenv("DATABASE_URL") or "sqlite:///./mirutasalud.db"

# Railway usa postgres:// pero SQLAlchemy requiere postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
elif DATABASE_URL.startswith("postgresql"):
    # Railway requiere SSL para PostgreSQL
    # Agregar sslmode=require si no está presente en la URL
    parsed = urlparse(DATABASE_URL)
    query_params = parse_qs(parsed.query)
    
    # Si sslmode no está configurado, agregarlo
    if 'sslmode' not in query_params:
        query_params['sslmode'] = ['require']
        # Reconstruir la URL con sslmode
        new_query = urlencode(query_params, doseq=True)
        DATABASE_URL = urlunparse((
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            new_query,
            parsed.fragment
        ))
        print(f"DEBUG: DATABASE_URL configurada con SSL: {DATABASE_URL.split('@')[0]}@***")

engine = create_engine(DATABASE_URL, connect_args=connect_args)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
