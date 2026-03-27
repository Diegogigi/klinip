# Klinip — Contexto del proyecto

> Este archivo existe para darle contexto completo a Claude Code antes de trabajar en el proyecto.
> Léelo siempre antes de tocar cualquier archivo de Klinip.

---

## Qué es Klinip

Klinip es una plataforma SaaS AI-native de salud personal y familiar que centraliza documentos, medicamentos, citas, adherencia, reportes y colaboración en un solo espacio privado.

**Sitio web:** www.klinip.cl

### Definición para inversores

Klinip es una plataforma AI-native de salud personal y familiar que convierte cada evento clínico — un documento subido, una consulta grabada, una publicación en el feed — en inteligencia activa que anticipa, prioriza y orienta.

### Frase de posicionamiento

> "Klinip es el sistema nervioso de tu salud personal y familiar: escucha al médico, entiende tu historial, y te ayuda a actuar antes de que el problema escale."

---

## Lo que Klinip ES y NO ES

### Es:
- Una SaaS con cuentas, planes, perfiles y colaboración
- Una plataforma de salud digital para personas, familias y cuidadores
- Una app de gestión clínica personal/familiar (no un HIS hospitalario ni EMR para clínicas)
- AI-native: la IA es la capa de interpretación, no un add-on encima
- Una red social privada de salud (KlinipFeed), no una red abierta

### No es:
- Solo un chatbot
- Solo una agenda médica
- Una red social pública
- Un agente autónomo que actúa solo
- Un reemplazo de evaluación médica profesional

---

## Módulos principales (reposicionados como inteligencia activa)

### 1. Perfil → Agente de perfil
- Detecta cambios relevantes en el estado clínico
- Alerta inconsistencias entre datos
- Sugiere acciones basadas en el historial

### 2. Medicamentos → Agente de adherencia
- Lista de medicamentos, dosis, frecuencia y tomas
- Detecta incumplimiento de adherencia
- Predice riesgo de abandono de tratamiento
- Recomienda ajustes (orientativos, no clínicos)

### 3. Documentos → Agente clínico documental
- OCR y lectura automática de recetas, órdenes, resultados e informes
- Identifica anomalías en los documentos
- Compara con el historial del perfil
- Genera alertas clínicas relevantes
- IMPORTANTE: No diagnostica. Orienta e identifica señales.

### 4. Radar → Motor de priorización inteligente
- Alertas activas, brechas y señales relevantes
- Sistema de priorización: muestra lo más importante primero
- Ventaja competitiva clave de Klinip

### 5. Klinip Voice *(ver sección detallada más abajo)*

### 6. KlinipFeed → Sensor clínico colectivo privado
- Feed privado de salud para registrar avances, resultados y novedades
- Cada post es una señal clínica que Klinip IA puede interpretar
- Lógica social cerrada: publicaciones, comentarios, respuestas, menciones, likes, notificaciones
- No es una red abierta. Es un feed familiar/cuidador privado.

### 7. Klinip IA → Copiloto clínico
- Usa contexto real del perfil activo: documentos, citas, medicamentos, adherencia, alertas, memoria clínica y contexto familiar
- Considera indicaciones médicas capturadas por Klinip Voice para dar respuestas con contexto real
- Puede explicar, resumir, priorizar y orientar
- NO diagnostica ni reemplaza atención médica

---

## Klinip Voice — Especificación completa

### Qué es
Un feature de grabación de consultas médicas que convierte la voz del médico en inteligencia clínica accionable para el paciente, su familia, y el propio profesional.

> Klinip Voice no solo sirve al paciente — es un puente bidireccional entre la consulta y el registro clínico del profesional.

---

### Flujo completo — 3 fases

#### Fase 1 — Captura y consentimiento

1. Usuario activa Klinip Voice desde la app
2. Pantalla de aviso obligatoria: instrucciones claras sobre el proceso
3. **Consentimiento digital en app:** usuario confirma con botón explícito (no omitible)
4. **Grabación de consentimiento verbal:** se inicia grabación corta donde el profesional autoriza con su voz
   - Este audio se guarda SEPARADO del audio clínico
   - Está sellado: no editable, con timestamp exacto
   - Primera versión: el usuario presiona botón manual "el profesional acaba de autorizar" (más robusto y defendible que detección automática)
5. **Grabación clínica activa:** comienza el audio completo de la consulta

#### Fase 2 — Procesamiento IA

Klinip IA procesa el audio y genera simultáneamente:

| Output | Descripción | Destinatario |
|--------|-------------|--------------|
| Audio de consentimiento | Sellado, separado, no editable | Archivo legal Klinip |
| Transcripción técnica | Texto completo, lenguaje médico, fuente de verdad | Profesional + archivo |
| Versión simple | Lenguaje claro para no especialistas | Paciente y familia |
| Indicaciones extraídas | Lista estructurada de indicaciones del médico | Paciente y familia |
| Recordatorios automáticos | Generados a partir de las indicaciones | Paciente y familia |

#### Fase 3 — Compartir con el profesional

Al terminar la grabación, el usuario puede seleccionar qué compartir:
- Audio original de la consulta
- Transcripción técnica completa

**Canales de envío disponibles:**
- Correo electrónico (adjunto + link seguro)
- WhatsApp (link seguro con expiración)
- PDF descargable

---

### Vista del profesional — sin cuenta Klinip

El profesional NO necesita cuenta en Klinip. Recibe un link autocontenido que abre una vista limpia con:

**Header:** Registro de consulta — Klinip Voice · vista segura · acceso temporal

**Metadatos de sesión:**
- Fecha y hora de la consulta
- Nombre del perfil
- Confirmación: "consentimiento verbal registrado el [timestamp]"

**Contenido disponible:**
- Reproductor de audio integrado (audio de la consulta)
- Transcripción técnica completa en pantalla

**Descargas disponibles:**
- Descarga directa del audio (archivo)
- Descarga del PDF técnico (ver especificación del PDF más abajo)

**Link seguro:**
- Expira en 48 horas por defecto
- Extensible por el usuario desde su app

**Trazabilidad automática (silenciosa):**
Klinip registra y muestra al usuario en su ficha:
- Si el link fue abierto
- Si el audio fue reproducido
- Si los archivos fueron descargados
- Fecha y hora exacta de cada acción

> Esto cierra el ciclo: el paciente puede ver "el Dr. Martínez abrió el registro el martes a las 15:32 y descargó el PDF."

---

### Dos PDFs distintos — misma consulta, dos audiencias

#### PDF para el profesional (técnico)
- Transcripción técnica completa
- Metadatos de sesión (fecha, hora, perfil)
- Timestamp del consentimiento verbal
- Hash de integridad del audio (demuestra que no fue alterado)
- Formato: documento oficial, lenguaje médico

#### PDF para el paciente/familia (simple)
- Versión en lenguaje claro y simple
- Indicaciones extraídas por Klinip IA
- Recordatorios generados
- Formato: legible, sin tecnicismos

---

### Diseño de 3 capas — por qué es así

| Capa | Contenido | Propósito |
|------|-----------|-----------|
| Audio original | Grabación completa de la consulta | Fuente de verdad inapelable |
| Transcripción técnica | Texto fiel al audio, lenguaje médico | Respaldo ante alucinaciones de IA |
| Versión simple | Traducción de Klinip IA | Lo que el paciente y familia entienden |

La IA traduce e interpreta, pero nunca reemplaza ni reformula las indicaciones originales del médico.

---

### Por qué Klinip Voice es estratégicamente importante

1. **Resuelve comprensión familiar:** El cuidador que no entiende lenguaje técnico recibe la información en términos simples, sin alterar la fuente original
2. **Genera valor para el profesional:** Recibe un registro estructurado de la atención que puede guardar en su propio sistema, sin fricciones
3. **Defensible regulatoriamente:** Audio de consentimiento separado y sellado. La IA traduce, no reformula indicaciones médicas
4. **Activo de datos único:** Indicaciones médicas reales en contexto, vinculadas a perfiles con historial y seguimiento posterior
5. **Trazabilidad completa:** Cada acción queda registrada — consentimiento, procesamiento, apertura, descarga

---

### Lo que Klinip Voice NO hace
- No reformula indicaciones médicas (solo traduce y extrae)
- No diagnostica
- No actúa de forma autónoma sobre las indicaciones
- No requiere que el profesional tenga cuenta en Klinip

---

### Producto futuro — cuenta para profesionales

> Registrado como línea de expansión futura. No forzar en v1.

Si muchos profesionales empiezan a recibir estos envíos y valoran el formato, Klinip podría ofrecer una cuenta para profesionales — no para gestionar pacientes, sino para recibir y organizar estos registros automáticamente. La arquitectura actual no debe cerrar esa puerta.

---

### Notas regulatorias de Klinip Voice

- En Chile (y gran parte de LATAM) grabar sin consentimiento explícito del interlocutor puede tener consecuencias legales
- El audio de consentimiento verbal grabado y sellado es el respaldo legal más fuerte: es la propia voz del profesional autorizando
- El hash del audio original demuestra que el archivo no fue editado post-sesión (estándar en evidencia digital)
- Klinip genera recomendaciones orientativas, no decisiones clínicas — esa distinción es regulatoria, no solo semántica

---

## Modelo de planes

| Plan | Perfiles | Capacidades |
|------|----------|-------------|
| Básico | 1 perfil | Gestión esencial, IA básica, feed personal |
| Plus | Hasta 3 perfiles | IA completa, más profundidad clínica |
| Familiar | Hasta 5 perfiles | Colaboración multiusuario, panel familiar, calendarios compartidos, feed familiar |

---

## Otras capacidades de la plataforma

- Gestión de citas, calendario y próximos eventos
- Cronología / timeline de eventos de salud
- Reportes clínicos estructurados
- Notas rápidas del perfil
- Notificaciones y recordatorios
- Seguridad reforzada para documentos y acceso
- Colaboración familiar con roles y accesos

---

## Posicionamiento competitivo

### La tabla de diferenciación

| Apps de salud típicas | Klinip |
|-----------------------|--------|
| Guarda información | Interpreta señales |
| Muestra datos | Prioriza lo que importa |
| Responde preguntas | Anticipa con contexto |
| Organiza documentos | Extrae inteligencia clínica |
| Graba audio | Convierte voz médica en acción |

### Activos estratégicos que genera Klinip
1. Datos clínicos estructurados de pacientes reales
2. Patrones de comportamiento y adherencia
3. IA entrenada en contexto clínico real
4. Indicaciones médicas reales vinculadas a historial (Klinip Voice)
5. Trazabilidad completa del ciclo consulta → registro → seguimiento

---

## Notas regulatorias generales

- Klinip genera **recomendaciones orientativas**, no decisiones clínicas
- Esa distinción no es semántica — es regulatoria y de liability
- "Genera decisiones" en salud puede requerir clasificación como dispositivo médico
- El posicionamiento correcto: Klinip anticipa y orienta, el usuario y el médico deciden

---

## Stack / contexto técnico

*(Completar con stack real del proyecto)*

---

*Última actualización: sesión de estrategia con Claude — marzo 2026*
*Cambios en esta versión: especificación completa de Klinip Voice — fases, flujo, vista profesional, dos PDFs, trazabilidad, producto futuro (cuenta profesionales), notas regulatorias*
