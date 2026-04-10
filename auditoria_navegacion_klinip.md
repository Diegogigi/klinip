# Auditoria de navegacion Klinip

Fecha: 2026-04-09

## Objetivo

Mapear la navegacion actual de Klinip contra la arquitectura objetivo de 5 secciones:

1. Inicio
2. Asistente
3. Voz
4. Familia
5. Mi salud

El criterio principal es no romper rutas existentes ni enlaces profundos. Las rutas actuales deben conservarse como alias o rutas secundarias hasta que la migracion visual este validada.

## Estado actual

La aplicacion usa `HashRouter` y las rutas principales estan declaradas en `frontend/src/App.jsx`.

Rutas publicas actuales:

| Ruta | Pantalla actual | Decision |
| --- | --- | --- |
| `/` sin sesion | Landing | Conservar |
| `/login` | Login | Conservar |
| `/register` | Registro | Conservar |
| `/forgot-password` | Recuperar clave | Conservar |
| `/reset-password` | Restablecer clave | Conservar |
| `/planes` | Planes | Conservar |
| `/planes/:planSlug` | Detalle de plan | Conservar |
| `/legal/privacy` | Politica de privacidad | Conservar |
| `/legal/terms` | Terminos de uso | Conservar |
| `/legal/consent` | Consentimiento informado | Conservar |
| `/legal/notificaciones` | Notificaciones legales | Conservar |
| `/voice/shared/:token` | Resumen de voz compartido | Conservar |

Rutas protegidas actuales:

| Ruta | Pantalla actual | Nuevo lugar UX |
| --- | --- | --- |
| `/` con sesion | Dashboard | Inicio |
| `/ai` | AiKlinip | Asistente |
| `/voice` | KlinipVoicePage | Voz |
| `/feed` | KlinipFeed | Familia |
| `/family` | Settings con `initialSection="familia"` | Familia, pero con conflicto funcional |
| `/appointments` | Appointments | Acceso rapido desde Inicio y agenda secundaria |
| `/calendar` | Calendar | Acceso rapido desde Inicio y agenda secundaria |
| `/timeline` | Timeline | Mi salud > Historia clinica |
| `/documents` | Documents | Mi salud > Documentos |
| `/medications` | Medications | Mi salud > Medicamentos |
| `/stats` | Stats | Mi salud > Estadisticas, no protagonista |
| `/clinical-reports` | ClinicalReports | Mi salud > Reportes |
| `/settings` | Settings con `initialSection="perfil"` | Perfil/configuracion, no seccion principal |

## Navegacion principal actual

El menu lateral actual tiene 11 entradas:

| Etiqueta actual | Ruta | Problema |
| --- | --- | --- |
| Inicio | `/` | Correcta |
| KlinipFeed | `/feed` | No cumple: usa "Feed" y duplica Familia |
| IA Klinip | `/ai` | Debe llamarse "Asistente" |
| Klinip Voice | `/voice` | Debe llamarse "Voz" |
| Citas | `/appointments` | Debe salir del menu principal y quedar como acceso rapido |
| Calendario | `/calendar` | Debe salir del menu principal y quedar como acceso rapido |
| Stats | `/stats` | No cumple: ingles; debe quedar bajo Mi salud |
| Historia | `/timeline` | Debe quedar bajo Mi salud |
| Meds | `/medications` | No cumple: ingles; debe quedar bajo Mi salud |
| Docs | `/documents` | No cumple: ingles; debe quedar bajo Mi salud |
| Mi familia | `/family` | Correcta como concepto, pero hoy abre configuracion familiar |

En movil, la navegacion actual usa 4 accesos principales y "Otros". La arquitectura objetivo necesita 5 accesos visibles:

1. Inicio
2. Asistente
3. Voz
4. Familia
5. Mi salud

## Mapa propuesto de migracion

### Inicio

Ruta canonica: `/`

Conservar el dashboard como pantalla principal. Sus accesos rapidos pueden seguir apuntando a rutas existentes:

- Citas: `/appointments`
- Medicamentos: `/medications`
- Documentos: `/documents`
- Calendario: `/calendar`

No crear rutas duplicadas para el Radar de salud. Debe vivir solo en Inicio.

### Asistente

Ruta actual: `/ai`

Decision segura:

- Mantener `/ai` para no romper enlaces internos.
- Cambiar la etiqueta visible del menu y topbar a "Asistente".
- Opcional en fase posterior: agregar alias `/asistente` y redirigir `/ai` cuando ya no haya enlaces internos antiguos.

Textos a revisar:

- "IA Klinip" puede mantenerse dentro de contenido si se refiere al producto, pero la seccion principal debe llamarse "Asistente".
- Evitar botones internos "Meds" y "Docs"; usar "Medicamentos" y "Documentos".

### Voz

Ruta actual: `/voice`

Decision segura:

- Mantener `/voice`.
- Cambiar etiqueta visible a "Voz".
- Mantener `/voice/shared/:token` sin cambios porque es enlace publico compartido.

Textos a revisar:

- "Klinip Voice" puede mantenerse como nombre de producto si la decision de marca lo exige, pero la navegacion principal debe decir "Voz".

### Familia

Ruta objetivo: `/family`

Conflicto actual:

- `/feed` contiene la experiencia de publicaciones familiares privadas.
- `/family` abre configuracion familiar dentro de `Settings`.

Decision recomendada:

- Convertir `/family` en la seccion principal de apoyo familiar usando la experiencia de `KlinipFeed`.
- Mantener `/feed` como alias temporal o redireccion a `/family`.
- Mover la configuracion familiar actual a una accion secundaria dentro de Familia, por ejemplo "Gestionar familia", o dejarla dentro de `/settings` como seccion "Mi familia".

Textos a corregir:

- "KlinipFeed" -> "Familia" o "Red familiar".
- "feed" -> "actualizaciones" cuando sea texto visible.
- "publicacion" puede mantenerse, aunque "actualizacion" es mas humano para pacientes.

### Mi salud

Ruta nueva recomendada: `/mi-salud`

Debe ser un contenedor de informacion estructurada, no un menu tecnico.

Contenido:

- Historia clinica: ruta actual `/timeline`
- Documentos: ruta actual `/documents`
- Medicamentos: ruta actual `/medications`
- Estadisticas: ruta actual `/stats`
- Reportes: ruta actual `/clinical-reports`

Decision segura:

- Agregar `/mi-salud` como pantalla contenedora o entrada principal.
- Mantener rutas actuales como enlaces profundos para no romper accesos desde Inicio, notificaciones, onboarding y enlaces internos.
- Quitar `/timeline`, `/documents`, `/medications`, `/stats` y `/clinical-reports` del menu principal.

## Rutas que deben conservarse como alias o secundarias

| Ruta actual | Motivo |
| --- | --- |
| `/appointments` | Usada por Dashboard, Calendar y onboarding |
| `/calendar` | Usada por Dashboard y como acceso rapido |
| `/medications` | Usada por Dashboard, onboarding y alertas |
| `/documents` | Usada por Dashboard y onboarding |
| `/timeline` | Usada por Dashboard como historial |
| `/stats` | Usada por Radar de salud en Dashboard |
| `/clinical-reports` | Usada desde Settings |
| `/feed` | Debe sobrevivir como alias temporal a Familia |
| `/family` | Debe ser canonica para Familia, pero hoy tiene conflicto con Settings |
| `/ai` | Usada por Dashboard y Settings |
| `/voice` | Usada por Dashboard y enlaces de grabacion |

## Riesgos detectados

1. Duplicacion entre `/feed` y `/family`

   La arquitectura objetivo dice que "Familia" reemplaza "Klinip Feed". Hoy son experiencias distintas: publicaciones familiares en `/feed` y gestion familiar en `/family`.

2. Exceso de navegacion principal

   El menu actual tiene 11 entradas. Debe reducirse a 5 sin eliminar rutas internas.

3. Etiquetas en ingles o poco humanas

   En `frontend/src/App.jsx` aparecen `KlinipFeed`, `Stats`, `Meds` y `Docs` como etiquetas del menu.

4. Topbar desalineada

   El mapa de titulos del topbar usa `Resumen`, `IA Klinip`, `KlinipFeed` y `Klinip Voice`. Debe alinearse con `Inicio`, `Asistente`, `Familia` y `Voz`.

5. Mojibake existente en pantallas tocadas por la nueva arquitectura

   Se detectaron caracteres corruptos en `frontend/src/pages/Calendar.jsx`, especialmente en el encabezado del calendario, la descripcion mensual, los controles anterior/siguiente y la leyenda.

   Tambien se detectaron caracteres corruptos visibles en `frontend/src/pages/KlinipFeed.jsx`, especialmente en el compositor, los estados de carga y el estado vacio.

## Orden seguro de implementacion

1. Cambiar solo la navegacion visible a 5 secciones:
   - Inicio -> `/`
   - Asistente -> `/ai`
   - Voz -> `/voice`
   - Familia -> `/family`
   - Mi salud -> `/mi-salud`

2. Crear `/mi-salud` como contenedor y enlazar desde alli:
   - Historia clinica -> `/timeline`
   - Documentos -> `/documents`
   - Medicamentos -> `/medications`
   - Estadisticas -> `/stats`
   - Reportes -> `/clinical-reports`

3. Resolver Familia:
   - Montar la experiencia familiar principal en `/family`.
   - Mantener `/feed` como alias temporal.
   - Conservar gestion familiar como accion secundaria.

4. Corregir copy visible:
   - Reemplazar etiquetas en ingles.
   - Corregir mojibake en `Calendar.jsx` y `KlinipFeed.jsx`.
   - Revisar `Landing.jsx`, `Plans.jsx` y `data/plans.js` porque aun mencionan `KlinipFeed`.

5. Validar UI:
   - Tema claro y oscuro en menu, topbar, Familia, Mi salud y accesos rapidos.
   - Movil compacto con 5 accesos visibles sin menu "Otros" como navegacion principal.
   - Copy en espanol sin mojibake.

## Checklist para la siguiente fase

- [x] Actualizar `links` de `Sidebar` en `frontend/src/App.jsx`.
- [x] Actualizar `mobilePrimaryLinks` para que tenga 5 secciones.
- [x] Actualizar `ROUTE_TRANSITION_ORDER` con el nuevo orden mental.
- [x] Actualizar titulos del `Topbar`.
- [x] Crear ruta protegida `/mi-salud`.
- [x] Mantener rutas existentes como secundarias.
- [x] Resolver el conflicto `/feed` vs `/family`.
- [x] Corregir copy visible en ingles y mojibake.
- [x] Revisar tema claro/oscuro.
- [x] Revisar movil compacto.
