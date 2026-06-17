import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
from .env_loader import load_project_env

load_project_env()

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

engine_kwargs = {"connect_args": connect_args}
if DATABASE_URL.startswith("postgresql"):
    # Configuración de pool robusta para producción:
    # - pool_pre_ping: valida cada conexión antes de usarla (evita usar conexiones
    #   muertas tras reinicios o blips de red — causa típica de timeouts 524).
    # - pool_recycle: recicla conexiones cada 30 min (evita que Postgres las cierre
    #   por inactividad y queden inservibles).
    # - pool_size/max_overflow: más holgura para llamadas lentas (visión/embeddings).
    engine_kwargs.update(
        {
            "pool_pre_ping": True,
            "pool_recycle": int(os.getenv("DB_POOL_RECYCLE", "1800")),
            "pool_size": int(os.getenv("DB_POOL_SIZE", "10")),
            "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "20")),
            "pool_timeout": int(os.getenv("DB_POOL_TIMEOUT", "30")),
        }
    )

engine = create_engine(DATABASE_URL, **engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
