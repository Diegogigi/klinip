# Klinip - Checklist Ejecutivo de Lanzamiento

> Reordenado a partir de la auditoria pre-lanzamiento.
> Uso recomendado: trabajar en orden de prioridad y marcar cada item con `✅`
> cuando este completo, agregando una nota breve con lo realizado.

---

## 1. Decision de salida

### Puede salir ya
- [ ] Landing de pre-lanzamiento
- [ ] Lista de espera
- [ ] Cobro con links de pago

### No debe salir todavia
- [ ] App completa con usuarios reales
- [ ] Lanzamiento comercial abierto de la plataforma clinica

### Condicion para abrir la app real
- [ ] Completar Seguridad critica
- [ ] Completar Calidad minima operativa
- [ ] Ejecutar smoke test final

---

## 2. Prioridad maxima - Bloquea lanzamiento

Estos items deben completarse antes de abrir acceso real a usuarios de la app.

### 2.1 Rotar y sacar secretos VAPID del repo

**Estado actual**
- Completo: repo saneado, claves rotadas en Railway y validacion push realizada.

- [x] Generar nuevas claves VAPID
- [x] Eliminar las claves visibles de `CONFIGURACION_RAILWAY.md`
- [x] Agregar las nuevas claves en Railway como `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`
- [x] Confirmar que el codigo usa `os.environ` y no tiene fallbacks hardcodeados
- [x] Asumir comprometidas las claves antiguas y dejarlas fuera de uso
- [x] Verificar que no queden secretos expuestos en documentacion o archivos de ejemplo
- [x] Agregar `VAPID_EMAIL` y `VITE_VAPID_PUBLIC_KEY` nuevos en Railway
- [x] Redeploy despues de la rotacion
- [x] Probar nueva suscripcion push en al menos un dispositivo real

**Nota**
- Listo en repo: se eliminaron claves publicadas de `CONFIGURACION_RAILWAY.md`
  y `CONFIGURACION_VAPID.txt`, y backend ya no usa fallback embebido para
  `VAPID_EMAIL`.
- Listo fuera del repo: claves nuevas generadas, cargadas en Railway y flujo
  push validado end-to-end.

**Contexto**
- Las claves VAPID permiten enviar notificaciones push en nombre de la app.
- Si estan en el repo, se consideran filtradas aunque el repositorio sea privado.

**Archivos a revisar**
- `CONFIGURACION_RAILWAY.md`
- `CONFIGURACION_VAPID.txt`
- `.env.example` o equivalentes
- cualquier documento de despliegue o soporte

---

### 2.2 Cerrar CORS en produccion
- [x] Identificar la logica actual de fallback en `backend/app/main.py`
- [x] Cambiar el comportamiento para que en produccion el servidor no arranque si falta `ALLOWED_ORIGINS`
- [x] Configurar `ALLOWED_ORIGINS` en Railway con los dominios reales
- [x] Verificar que el frontend puede consumir la API desde el dominio oficial
- [x] Verificar que un origen no autorizado no recibe headers CORS validos

**Estado actual**
- Completo: backend endurecido, `ALLOWED_ORIGINS` configurado en Railway y validacion realizada desde produccion.

**Contexto**
- En una app de salud, `["*"]` en produccion es un riesgo innecesario.
- El fallback permisivo hace que una mala configuracion termine expuesta sin aviso real.

**Archivos a revisar**
- `backend/app/main.py`

---

### 2.3 Reducir `/health` a respuesta minima
- [x] Identificar el endpoint `/health` en `backend/app/main.py`
- [x] Eliminar del response cualquier dato operativo sensible
- [x] Dejar una respuesta minima, por ejemplo `status` y `timestamp`
- [x] Si se necesita telemetria interna, moverla a un endpoint separado protegido
- [x] Verificar que Railway pueda seguir usando el endpoint para health checks

**Estado actual**
- Completo: endpoint publico reducido a respuesta minima y validado en Railway y en `www.klinip.cl`.

**Contexto**
- `/health` es publico por diseno.
- No debe exponer usuarios, configuracion de correo, fragmentos de base de datos ni senales de seguridad.

**Archivos a revisar**
- `backend/app/main.py`

---

### 2.4 Fail duro si falta `SECRET_KEY`
- [x] Identificar la carga de `SECRET_KEY` en `backend/app/auth.py`
- [x] Eliminar cualquier valor por defecto inseguro
- [x] Hacer que el servidor falle al arrancar si `SECRET_KEY` no esta configurada
- [x] Agregar mensaje de error claro para despliegue
- [ ] Confirmar que Railway tiene una `SECRET_KEY` segura
- [ ] Verificar arranque correcto despues del cambio

**Estado actual**
- Parcial: backend endurecido para fallar si `SECRET_KEY` falta o usa un valor inseguro.
- Pendiente operativo: desplegar y confirmar arranque correcto con la `SECRET_KEY` real de Railway.

**Contexto**
- Si existe un valor por defecto conocido, los JWT pueden ser forjados.
- En produccion no debe existir modo degradado para esta variable.

**Archivos a revisar**
- `backend/app/auth.py`

---

## 3. Prioridad alta - Necesario para operar sin caos

Estos items no bloquean una landing o preventa, pero si afectan la apertura seria de la app.

### 3.1 Smoke tests manuales documentados
- [ ] Crear archivo `QA_SMOKE_TESTS.md` en la raiz
- [ ] Documentar flujo de registro
- [ ] Documentar flujo de login y logout
- [ ] Documentar recuperacion de contrasena
- [ ] Documentar seleccion y activacion de plan
- [ ] Documentar creacion y visualizacion de perfil de salud
- [ ] Documentar flujo de Klinip Voice
- [ ] Documentar compartido familiar
- [ ] Documentar activacion y prueba de notificaciones push
- [ ] Ejecutar todos los flujos al menos una vez en produccion antes de abrir acceso
- [ ] Definir responsable del checklist antes de cada deploy

**Objetivo**
- Tener una red de seguridad operativa, aunque todavia no existan tests automatizados.

---

### 3.2 Separar migraciones del arranque del servidor
- [ ] Instalar Alembic
- [ ] Inicializar Alembic en el proyecto
- [ ] Generar una migracion inicial a partir del esquema actual
- [ ] Remover o condicionar la creacion/alteracion automatica de esquema en produccion
- [ ] Ajustar el deploy en Railway para correr `alembic upgrade head` antes del servidor
- [ ] Probar el flujo completo: migracion -> arranque -> validacion funcional

**Contexto**
- El servidor no deberia mutar la base de datos silenciosamente al arrancar en produccion.
- Las migraciones controladas reducen riesgo y dejan trazabilidad.

**Archivos a revisar**
- `backend/app/main.py`
- `backend/requirements.txt`
- configuracion de deploy en Railway

---

## 4. Puede correr en paralelo

Estos items si pueden avanzar mientras se trabaja el bloque de seguridad.

### 4.1 Landing de pre-lanzamiento
- [ ] Crear una version simplificada de `frontend/src/pages/Landing.jsx`
- [ ] Hero con promesa unica
- [ ] CTA principal: `Unete a la lista de espera`
- [ ] CTA secundaria: acceso anticipado o reserva
- [ ] Seccion con 3 beneficios clave: IA, seguimiento familiar, Klinip Voice
- [ ] Planes simplificados: mostrar Plus y Familiar
- [ ] Bloque de prueba social o metricas
- [ ] FAQ de confianza: privacidad, disponibilidad, acceso anticipado
- [ ] Cierre con WhatsApp o formulario simple
- [ ] Verificar que la landing funcione bien en movil
- [ ] Evitar dependencia critica del backend para la conversion principal

---

### 4.2 Configurar cobro con links de pago de Mercado Pago
- [ ] Crear cuenta de vendedor en Mercado Pago Chile si aun no existe
- [ ] Crear 4 links manuales de pago
- [ ] Plus mensual
- [ ] Plus anual
- [ ] Familiar mensual
- [ ] Familiar anual
- [ ] Configurar nombre, precio, descripcion e imagen en cada link
- [ ] Conectar los links a los CTAs de la landing
- [ ] Definir flujo operativo post-pago
- [ ] Definir quien revisa pagos
- [ ] Definir como se activa el plan
- [ ] Definir en cuanto tiempo maximo se activa
- [ ] Definir como se notifica al cliente
- [ ] Documentar este flujo en un archivo interno
- [ ] Hacer una compra de prueba y validar el proceso completo

**Referencia**
- https://www.mercadopago.cl/ayuda/medios-de-pago-tiendas-online-Link-de-pago_19301

---

## 5. Orden recomendado de ejecucion

### Fase 1
- [ ] Rotacion VAPID
- [ ] CORS cerrado
- [ ] `/health` minimo
- [ ] `SECRET_KEY` obligatoria

### Fase 2
- [ ] Definir operacion manual post-pago
- [ ] Crear links de pago
- [ ] Disenar landing de pre-lanzamiento

### Fase 3
- [ ] Publicar landing
- [ ] Abrir lista de espera y/o preventa

### Fase 4
- [ ] Crear smoke tests manuales
- [ ] Implementar migraciones controladas
- [ ] Validacion final en produccion

### Fase 5
- [ ] Go / No-Go de lanzamiento de la app completa

---

## 6. Semaforo ejecutivo

### Verde
- [ ] Landing pre-lanzamiento
- [ ] Lista de espera
- [ ] Links de pago

### Amarillo
- [ ] Operacion manual post-pago
- [ ] Smoke tests
- [ ] Migraciones controladas

### Rojo
- [ ] Secretos expuestos
- [ ] CORS abierto
- [ ] Healthcheck demasiado verboso
- [ ] `SECRET_KEY` con fallback inseguro

---

## 7. Veredicto final

### Se puede lanzar marketing y preventa cuando:
- [ ] Landing lista
- [ ] Links de pago listos
- [ ] Operacion manual post-pago definida

### Se puede lanzar la app completa cuando:
- [ ] Seguridad critica cerrada
- [ ] Calidad minima operativa cerrada
- [ ] Smoke tests aprobados
- [ ] Despliegue validado

---

## 8. Estado general

| Bloque | Estado recomendado |
|--------|--------------------|
| Seguridad critica | En curso, con VAPID parcialmente resuelto en repo |
| Calidad minima operativa | Pendiente antes de lanzar la app completa |
| Landing y cobro | Puede iniciar ya |

---

**Resumen ejecutivo**
- La landing y el cobro pueden salir antes.
- La app completa no debe abrirse todavia.
- El foco inmediato sigue siendo seguridad critica y preparacion operativa minima.
- VAPID quedo resuelto parcialmente en codigo y documentacion, pero falta la
  rotacion real en Railway.
