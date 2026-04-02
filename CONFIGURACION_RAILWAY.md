# Configuracion de Variables de Entorno en Railway

## Objetivo

Este archivo documenta la configuracion segura de push y el scheduler de
notificaciones en Railway sin publicar secretos dentro del repositorio.

---

## Variables requeridas — Backend

Configura estas variables en Railway → Settings → Variables del servicio **backend**:

```env
# ── PUSH NOTIFICATIONS (VAPID) ──────────────────────────────────────────────
VAPID_PUBLIC_KEY=<rota_esta_clave_publica>
VAPID_PRIVATE_KEY=<rota_esta_clave_privada>
VAPID_EMAIL=mailto:soporte@klinip.cl

# ── SCHEDULER DE RECORDATORIOS ──────────────────────────────────────────────
# SIN esta variable el scheduler no arranca y NINGUNA notificacion se envia.
ENABLE_EMBEDDED_SCHEDULER=true

# Opcionales (los valores por defecto son razonables para produccion)
# WORKER_CYCLE_BUDGET_SECONDS=50   # segundos maximos por ciclo antes de cortar
# WORKER_JOB_TIMEOUT_SECONDS=25    # timeout por job individual
```

## Variables requeridas — Frontend (build)

```env
VITE_VAPID_PUBLIC_KEY=<rota_esta_clave_publica>
```

Notas:

- `VAPID_PUBLIC_KEY` y `VITE_VAPID_PUBLIC_KEY` deben tener el mismo valor.
- `VAPID_PRIVATE_KEY` solo debe existir en el servicio backend.
- Las claves antiguas publicadas en este repo deben considerarse comprometidas y
  quedar fuera de uso.

---

## Arquitectura del scheduler en Railway

### Opcion A — Embebido en el web process (default para un solo replica)

Con `ENABLE_EMBEDDED_SCHEDULER=true` el scheduler corre como un thread daemon
dentro del mismo proceso FastAPI. Simple, sin servicios extra.

**Limitacion:** si el proceso web esta bajo carga alta, el scheduler comparte
esos recursos. Para la mayoria de los lanzamientos iniciales esto es suficiente.

### Opcion B — Worker separado (recomendado a escala)

Crea un segundo servicio en Railway que ejecuta:

```bash
python -m app.worker
```

Con el mismo `DATABASE_URL`, `VAPID_*` y demas variables del backend.

Ventajas:
- Tráfico web no impacta los recordatorios
- El worker tiene retry y deadline por job integrados (runtime.py)
- Se puede escalar independientemente

Con esta opcion NO se necesita `ENABLE_EMBEDDED_SCHEDULER=true` en el web process
(de hecho es mejor dejarlo en false para no tener dos schedulers corriendo).

---

## Generar nuevas claves VAPID

Opcion recomendada con Node:

```bash
npx web-push generate-vapid-keys
```

Opcion con Python:

```bash
python -m pip install pywebpush
python -c "from py_vapid import Vapid01 as Vapid; k = Vapid(); k.generate_keys(); print('public=' + k.public_key.public_bytes().decode()); print('private=' + k.private_key.private_bytes().decode())"
```

Si usas la opcion de Python, valida primero el formato antes de cargarlo en
Railway.

---

## Checklist de deploy

1. Confirmar que `ENABLE_EMBEDDED_SCHEDULER=true` esta en Railway (o que el worker separado esta corriendo).
2. Confirmar `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` en backend.
3. Confirmar `VITE_VAPID_PUBLIC_KEY` en el build del frontend.
4. Forzar un redeploy.
5. Suscribir un dispositivo de prueba a push desde la app.
6. Llamar `POST /push/test` (autenticado) y verificar que llega la notificacion.
7. Agendar una cita de prueba con fecha en los proximos 7 minutos y esperar el recordatorio de "5 minutos antes".

## Verificacion de logs en Railway

Busca estas lineas en los logs del backend para confirmar que el scheduler esta vivo:

```
INFO startup: embedded scheduler enabled
INFO scheduler cycle: job=send_appointment_reminders ...
INFO scheduler cycle: job=send_medication_reminders ...
```

Si ves `INFO startup: embedded scheduler disabled for web process` es porque
`ENABLE_EMBEDDED_SCHEDULER` no esta configurada o tiene un valor incorrecto.

---

## Rotacion operativa de claves VAPID

1. Generar nuevas claves.
2. Cargarlas en Railway.
3. Desplegar backend y frontend.
4. Invalidar y dejar de usar las claves antiguas.
5. Pedir a usuarios de prueba que reactiven push si es necesario (el registro
   anterior queda invalido al cambiar las claves).
