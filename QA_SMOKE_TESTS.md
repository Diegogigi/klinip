# QA Smoke Tests - Klinip

## Objetivo

Este checklist sirve para validar los flujos criticos de Klinip antes de abrir
acceso real o despues de un deploy importante.

## Alcance minimo

Ejecutar al menos una vez:

- en `https://www.klinip.cl`
- con una cuenta paciente real de prueba
- con un dispositivo movil para validar PWA y push

## Responsable

- Responsable QA pre-deploy: `hp`
- Fecha ultima ejecucion: `2026-04-01`
- Entorno validado: `Produccion`

## Datos de prueba sugeridos

- Cuenta A: paciente principal
- Cuenta B: familiar/cuidador
- Un documento PDF o imagen de receta
- Un audio corto para Klinip Voice
- Un medicamento de prueba
- Una cita de prueba con fecha futura

## 1. Registro

Precondicion:
- no estar autenticado

Pasos:
1. Ir a `/register`
2. Crear una cuenta nueva con correo valido
3. Confirmar redireccion al flujo autenticado

Esperado:
- la cuenta se crea sin error
- el usuario queda autenticado
- el dashboard carga sin errores visibles

## 2. Login y logout

Precondicion:
- tener una cuenta existente

Pasos:
1. Ir a `/login`
2. Iniciar sesion con credenciales correctas
3. Navegar a una ruta protegida como `/`, `/medications` o `/documents`
4. Cerrar sesion desde el menu de usuario

Esperado:
- login exitoso
- las rutas protegidas cargan correctamente
- al cerrar sesion vuelve a `/login`
- no quedan errores de sesion en consola

## 3. Recuperacion de contrasena

Precondicion:
- tener acceso al correo de la cuenta de prueba

Pasos:
1. Ir a `/forgot-password`
2. Solicitar recuperacion con un correo registrado
3. Abrir el enlace recibido
4. Ir a `/reset-password` con token valido
5. Guardar una nueva contrasena
6. Iniciar sesion con la contrasena nueva

Esperado:
- el correo de recuperacion llega
- el enlace abre el formulario de reseteo
- la nueva contrasena queda activa

## 4. Seleccion y activacion de plan

Pasos:
1. Ir a `/planes`
2. Verificar que cargan los planes publicos
3. Iniciar sesion con una cuenta valida
4. Revisar estado del plan actual en UI

Esperado:
- los planes se muestran sin error
- el plan actual del usuario carga correctamente
- no hay errores de permisos ni de sesion

Nota:
- si la activacion del plan sigue siendo manual, registrar el resultado del paso
  operativo fuera de la app.

## 5. Perfil de salud

Pasos:
1. Entrar autenticado
2. Ir a `/settings`
3. Revisar el perfil activo
4. Crear o editar un perfil de salud si aplica
5. Cambiar el perfil activo si la cuenta tiene mas de uno

Esperado:
- carga el perfil activo
- guardar cambios funciona
- el cambio de perfil activo refresca los modulos dependientes

## 6. Medicamentos

Pasos:
1. Ir a `/medications`
2. Crear un medicamento nuevo
3. Verificar que aparece en la lista
4. Editarlo
5. Registrar una toma
6. Eliminar el medicamento de prueba si corresponde

Esperado:
- el formulario guarda correctamente
- la lista se actualiza
- la toma queda registrada
- editar y eliminar funcionan

## 7. Citas

Pasos:
1. Ir a `/appointments`
2. Crear una cita futura
3. Verificar que aparece en la lista
4. Editarla
5. Eliminar la cita de prueba si corresponde

Esperado:
- crear, editar y eliminar funcionan
- la cita aparece con la fecha correcta

## 8. Documentos

Pasos:
1. Ir a `/documents`
2. Subir un documento PDF o imagen
3. Verificar que aparece en la lista
4. Abrir el archivo
5. Editar metadatos basicos si aplica
6. Eliminar el documento de prueba si corresponde

Esperado:
- la carga termina sin error
- el documento se puede abrir
- el listado se actualiza

## 9. IA Klinip

Pasos:
1. Ir a `/ai`
2. Preguntar por citas, medicamentos y documentos existentes
3. Verificar que la respuesta use el contexto actualizado
4. Adjuntar audio corto si aplica

Esperado:
- responde sin error
- usa datos reales del usuario
- no muestra conteos incoherentes ni contexto stale

## 10. Klinip Voice

Pasos:
1. Ir a `/voice`
2. Subir audio de consentimiento
3. Subir audio de sesion
4. Esperar procesamiento
5. Abrir el resumen generado
6. Descargar PDF si aplica

Esperado:
- el procesamiento termina
- se genera resumen
- el PDF descarga correctamente si esta habilitado

## 11. Compartido familiar

Precondicion:
- dos cuentas de prueba

Pasos:
1. Desde Cuenta A, ir a `/family`
2. Invitar a Cuenta B como cuidador/familiar
3. Aceptar la invitacion desde Cuenta B
4. Verificar acceso compartido
5. Probar cambio de perfil activo o visualizacion compartida

Esperado:
- la invitacion se crea
- la aceptacion funciona
- Cuenta B ve solo lo permitido

## 12. Notificaciones push

Precondicion:
- dispositivo movil o navegador compatible
- permisos de notificacion disponibles

Pasos:
1. Entrar autenticado
2. Ir a configuracion de notificaciones
3. Activar push
4. Confirmar que la suscripcion queda activa
5. Enviar notificacion de prueba
6. Cerrar y volver a abrir la app

Esperado:
- la suscripcion push se registra
- la notificacion de prueba llega
- no hay duplicados
- el estado sigue activo al reabrir

## 13. Verificaciones tecnicas minimas post-deploy

Pasos:
1. Abrir `/health`
2. Verificar login
3. Verificar una ruta autenticada como `/me`
4. Verificar carga de assets principales
5. Verificar que no haya errores criticos en consola

Esperado:
- `/health` responde `status: ok`
- login y sesion funcionan
- no hay errores 401, 500, CORS ni push por configuracion faltante

## Criterio de aprobacion

Se considera smoke test aprobado cuando:

- todos los flujos criticos pasan o tienen incidencia menor documentada
- no hay bloqueos en login, sesion, documentos, medicamentos, citas, IA,
  Voice, familia ni push
- cualquier incidencia detectada queda anotada antes de abrir acceso real

## Registro de resultado

- Fecha: `2026-04-01`
- Responsable: `hp`
- Version o commit desplegado: `Deploy validado manualmente en Railway el 2026-04-01`
- Resultado general: `APROBADO`
- Incidencias: `Sin bloqueos criticos reportados en la ejecucion manual en produccion.`

## Cierre final de salida

- Fecha de cierre final: `2026-04-01`
- Estado final: `SMOKE TEST FINAL APROBADO`
- Decision operativa: `GO tecnico para apertura de la app completa`
- Observacion: `No quedan bloqueos tecnicos ni operativos minimos pendientes para abrir la app. Los pendientes restantes corresponden a landing, lista de espera, cobro y operacion comercial.`
