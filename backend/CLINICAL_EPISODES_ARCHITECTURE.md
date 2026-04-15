# Klinip: Arquitectura de Episodios Clínicos

## Objetivo
Pasar de módulos aislados a una historia clínica longitudinal por perfil, donde una atención pueda agrupar:

- cita médica o examen
- orden o receta
- resultados o informes
- tratamiento derivado
- tareas pendientes y próximos pasos

## Base implementada en esta fase

### Nuevas tablas
- `clinical_episodes`
  - agrupa el proceso de salud
  - vive por `profile_id`
  - mantiene `title`, `episode_type`, `status`, `started_at`, `last_activity_at`, `summary`, `care_summary`
- `clinical_tasks`
  - representa pendientes por episodio
  - soporta tareas automáticas y manuales
  - guarda fuente de origen (`source_module`, `source_record_type`, `source_record_id`)

### Nuevos campos de relación
- `appointments.profile_id`
- `appointments.episode_id`
- `documents.episode_id`
- `medications.profile_id`
- `medications.episode_id`
- `medication_purchases.episode_id`
- `external_clinical_records.episode_id`

## Regla de diseño
El `profile_id` resuelve a qué persona pertenece el dato.
El `episode_id` resuelve a qué proceso clínico pertenece ese dato.

Eso evita mezclar “propiedad del dato” con “contexto clínico del dato”.

## Reglas de vinculación automática

### Prioridad de vinculación
1. vínculo explícito enviado por frontend o API
2. vínculo relacional directo
3. heurística determinística simple
4. creación de un nuevo episodio

### Reglas directas ya implementadas
- Si un documento se sube con `appointment_id` y esa cita ya pertenece a un episodio, el documento entra al mismo episodio.
- Si un medicamento se crea con `document_id` y ese documento ya pertenece a un episodio, el medicamento entra al mismo episodio.
- Si un registro externo referencia `appointment_id`, `document_id` o `medication_id` dentro de `payload_json`, hereda ese episodio.

### Heurísticas simples implementadas
- comparación de tokens clínicos normalizados
  - especialidad
  - centro
  - notas
  - nombre de medicamento
  - tipo y nombre de documento
- cercanía temporal con `last_activity_at`
- unión por score mínimo antes de decidir reusar un episodio

### Reglas siguientes recomendadas
- si `appointment.type == examen` y luego aparece `document.doc_type == resultado` dentro de ventana de 30-45 días, priorizar el mismo episodio
- si una `receta` genera medicamentos registrados dentro de 7 días, mantenerlos unidos
- si una cita marcada `realizada` no genera orden, receta ni informe tras X días, crear tarea “falta documento de cierre”

## Servicios backend

### `episode_link_service`
- asigna o crea episodios
- aplica heurísticas
- sincroniza tareas automáticas básicas

### `timeline_builder_service`
- construye la línea longitudinal por episodio
- agrega citas, documentos, tratamientos, tomas y registros externos

### `clinical_summary_service`
- genera resumen ejecutivo del episodio
- calcula pendientes, siguiente vencimiento y última actividad

### `ai_context_service`
- consolida el contexto longitudinal por episodio
- prepara estructura usable por IA y por endpoints

## Endpoints implementados

### Listar episodios de un perfil
- `GET /health-profiles/{profile_id}/episodes`

### Obtener episodio completo
- `GET /health-profiles/{profile_id}/episodes/{episode_id}`

Incluye:
- episodio
- tareas
- timeline
- related_items
- ai_context

### Vincular o desvincular manualmente
- `PUT /health-profiles/{profile_id}/episodes/relink-item`

Payload:

```json
{
  "item_type": "document",
  "item_id": 123,
  "episode_id": 45
}
```

Para desvincular:

```json
{
  "item_type": "document",
  "item_id": 123,
  "episode_id": null
}
```

## Tareas automáticas actuales
- cita o examen pendiente -> tarea de asistencia / realización
- documento tipo `orden` -> tarea “Subir resultado del examen u orden”
- documento tipo `receta` -> tarea “Confirmar tratamiento indicado”

## Cambios de IA recomendados

### Nuevo contexto principal
La IA no debería leer solo listas planas de módulos. Debe recibir:

- perfil activo
- episodios relevantes ordenados por actividad
- episodio abierto actual
- tareas pendientes por episodio
- timeline resumido por episodio
- medicamentos derivados por episodio
- documentos de orden y resultado por episodio

### Preguntas longitudinales
Para consultas como:
- “¿qué pasó con mi consulta de traumatología?”
- “¿qué me falta de este proceso?”
- “¿qué medicamento salió de esta atención?”

la IA debería:
1. localizar episodio por tokens y tiempo
2. responder desde el `ai_context` del episodio
3. priorizar:
   - origen
   - hitos
   - pendientes
   - tratamiento derivado

## Rediseño UX recomendado para Historial

### En vez de cronología plana
Mostrar tarjetas por proceso:
- Traumatología rodilla
- Estudio de laboratorio anual
- Tratamiento antibiótico de marzo

### Cada tarjeta de episodio debería mostrar
- nombre simple del proceso
- estado
- fecha de inicio y última actividad
- próximo paso
- pendientes
- medicamentos activos derivados
- documentos principales

### Para usuarios mayores o con baja alfabetización digital
- lenguaje simple
- una idea por bloque
- “Qué pasó”
- “Qué falta”
- “Qué sigue ahora”
- “Quién puede ayudarte”

## Estrategia incremental

### Fase 1
- agregar tablas y `episode_id`
- auto-link determinístico
- endpoints de episodios
- resumen y timeline por episodio

### Fase 2
- rehacer sección `Historial`
- tarjetas por episodio
- vistas de pendientes y próximos pasos
- relink manual en frontend

### Fase 3
- conectar Klinip IA al contexto por episodio
- intención de preguntas longitudinales
- respuestas centradas en proceso, no en módulos

### Fase 4
- sugerencias asistidas por IA para vinculación ambigua
- fusión de episodios
- detección de procesos recurrentes o crónicos

## Criterios de éxito
- el usuario entiende qué forma parte de un mismo proceso
- la familia ve qué falta sin revisar varios módulos
- la IA puede responder longitudinalmente
- el sistema sigue siendo compatible con la app actual mientras migra UX y lógica
