# Plan de Mejora: Sistema Inteligente de Análisis de Documentos Médicos

## 1. VISIÓN GENERAL

Crear un sistema de análisis automático de documentos médicos que:
- ✅ **Identifica automáticamente** el tipo de documento (receta, orden, resultado, informe, etc.)
- ✅ **Extrae datos estructurados** (medicamentos, valores de laboratorio, diagnósticos)
- ✅ **Guarda automáticamente** en la sección correspondiente
- ✅ **Valida y alerta** sobre valores anormales o críticos
- ✅ **UX simple** para adultos mayores (fotos con cámara, sin tecnicismos)
- ✅ **Flujos inteligentes** según el tipo de documento y contexto del usuario

---

## 2. LO QUE YA EXISTE (BASE SÓLIDA)

### Infraestructura Actual:
```
✓ Modelo Document completo con tipos: receta, orden, resultado, informe, otro
✓ OCR automático con Tesseract (extrae texto de imágenes/PDF)
✓ Clasificación básica de tipos (regex sobre OCR text)
✓ Automaciones que crean Medication y Appointment
✓ Análisis IA con DocumentSummary + DocumentClinicalEntity
✓ Almacenamiento seguro en BD (BLOB)
✓ Frontend responsive con visor de documentos
✓ Step-up auth para documentos sensibles
✓ Búsqueda semántica via embeddings
```

### Lo que FALTA para potenciar:
```
✗ Clasificación avanzada (subtipos: qué tipo de resultado, qué medicamento)
✗ Extracción de valores normalizados (tensión: 120/80, hemoglobina: 12.5)
✗ Validación contra rangos de referencia
✗ Comparación histórica (evolución)
✗ Alertas inteligentes (valores críticos)
✗ UX ultra-simplificada para adultos mayores
✗ Flujos específicos para cada tipo de documento
✗ Procesamiento de documentos de baja calidad
✗ API robusta para subida desde otros sistemas
```

---

## 3. ARQUITECTURA PROPUESTA

### 3.1 Nuevos Modelos de BD

```python
# DocumentType Avanzado (actual: simple string)
class DocumentTypeClassification:
    document_id: FK → Document
    primary_type: Enum(receta, orden, resultado, informe, otro)
    subtype: String  # ej: "resultado_laboratorio", "resultado_imagen", "receta_controlada"
    medical_specialty: String  # ej: "cardiología", "general", "oncología"
    confidence: Int (0-100)
    extracted_metadata_json: JSON  # fecha_estudio, centro, especialista, etc

# Valores Extraídos y Normalizados
class DocumentExtractedValue:
    document_id: FK → Document
    value_type: Enum(medicamento, resultado_laboratorio, presion_arterial, glucosa, etc)
    value_name: String  # ej: "Hemoglobina", "Paracetamol"
    value_number: Decimal  # ej: 12.5
    value_unit: String  # ej: "g/dL", "mg"
    value_status: Enum(normal, alerta, critico)  # Comparado con rangos
    reference_range_min: Decimal (nullable)
    reference_range_max: Decimal (nullable)
    interpretation: String  # Explicación amigable: "Normal para su edad"
    confidence: Int (0-100)

# Alertas por Documento
class DocumentAlert:
    document_id: FK → Document
    alert_type: Enum(valor_critico, valor_anormal, accion_requerida, seguimiento)
    severity: Enum(info, advertencia, urgente)
    message: String  # Amigable: "Tu presión está alta, considera contactar a tu médico"
    recommended_action: String  # Ej: "Contactar cardiólogo"
    dismissed: Boolean (default False)
    created_at, dismissed_at

# Comparación Histórica
class DocumentValueHistory:
    value_type: String
    value_name: String
    history: JSON  # [{date, value, unit, status}, ...]
    trend: Enum(estable, mejorando, empeorando)
    last_updated: DateTime
```

### 3.2 Flujos de Procesamiento por Tipo

```
┌─────────────────────────────────────────────────────────────┐
│ 1. SUBIDA DE ARCHIVO                                        │
│    - Usuario selecciona foto/PDF/archivo                    │
│    - Validación de tamaño/formato                           │
│    - Almacenamiento en BD                                   │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 2. OCR + CLASIFICACIÓN AVANZADA (Background Task)           │
│    - Extrae texto con Tesseract                             │
│    - Clasifica tipo: receta|orden|resultado|informe|otro   │
│    - Clasifica subtype (ej: resultado_laboratorio_completo) │
│    - Identifica especialidad médica                         │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴───────────────┬─────────────┬─────────┐
        │                            │             │         │
┌───────▼──────────┐  ┌──────────┬──▼──┐  ┌──────▼──┐  ┌──────▼─────┐
│ FLUJO RECETA     │  │FLUJO     │ORDEN│  │FLUJO   │  │FLUJO OTRO  │
│ (Medicamentos)   │  │RESULTADO │     │  │INFORME │  │            │
├──────────────────┤  ├──────────┼─────┤  ├────────┤  ├────────────┤
│1. Extrae medic. │  │1.Parse   │1.Ex │  │1.Extrae│  │1. Procesa  │
│2. Normaliza     │  │   valores│trae │  │   texto│  │   contexto │
│3. Busca/crea    │  │2.Valida  │ fecha│  │2.Busca │  │2. Sugiere  │
│   en Medication │  │   contra │ hora│  │ patrón │  │   categoría│
│4. Crea Reminder │  │   rangos │3.Pro│  │3. Vinc │  │3. Guarda   │
│   (si es ctrl)  │  │3. Crea   │pone │  │ula a   │  │   como     │
│5. Notif familia │  │   alertas│cita │  │episode │  │   ref.     │
└──────────────────┘  │4. Vincula│4.Not│  │4. Busca│  └────────────┘
                      │ a appt   │ifi │  │ si hay │
                      │5. Notif  │ca  │  │seguim. │
                      └──────────┴─────┘  │5. Alerta│
                                          └────────┘
```

### 3.3 Extracción Inteligente de Valores

**Para Resultados de Laboratorio:**
```
Entrada OCR: "HEMOGLOBINA 12.5 g/dL [ref: 12-16]"

Salida normalizada:
{
  value_type: "resultado_laboratorio_hemoglobina",
  value_name: "Hemoglobina",
  value_number: 12.5,
  value_unit: "g/dL",
  value_status: "normal",
  reference_range_min: 12,
  reference_range_max: 16,
  interpretation: "Valor normal para adulto",
  trend: "estable" (comparado con último resultado)
}
```

**Para Medicamentos:**
```
Entrada OCR: "Paracetamol 500mg cada 8 horas"

Salida normalizada:
{
  value_type: "medicamento",
  value_name: "Paracetamol",
  value_number: 500,
  value_unit: "mg",
  frequency: "cada 8 horas",
  interpretation: "Tomar una pastilla cada 8 horas (máximo 3 por día)",
  flags: ["sin_receta_controlada", "comun"]
}
```

---

## 4. COMPONENTES A DESARROLLAR

### 4.1 Backend: Módulo de Análisis Inteligente

**Archivo:** `backend/app/document_intelligence.py`

```python
class DocumentIntelligenceEngine:
    
    # 1. Clasificación avanzada
    def classify_document_advanced(ocr_text, file_metadata):
        """
        Retorna: {
            primary_type: "receta|orden|resultado|informe|otro",
            subtype: "resultado_laboratorio_completo",
            specialty: "general|cardiologia|etc",
            confidence: 95,
            extracted_fields: {...}
        }
        """
    
    # 2. Extracción de valores
    def extract_values_from_document(document_type, ocr_text):
        """
        Retorna: [
            DocumentExtractedValue(name, value, unit, interpretation),
            ...
        ]
        """
    
    # 3. Validación de valores
    def validate_against_reference_ranges(values, patient_age, patient_sex):
        """
        Compara contra rangos de referencia normales
        Retorna: valores con status (normal|alerta|critico)
        """
    
    # 4. Detección de anomalías
    def detect_critical_values(extracted_values):
        """
        Retorna alertas por valores peligrosos
        """
    
    # 5. Análisis de tendencias
    def analyze_trends(extracted_value_type, historical_values):
        """
        Compara con historial del usuario
        Retorna: trend (estable|mejorando|empeorando)
        """
    
    # 6. Flujos automatizados
    def execute_document_workflow(document_type, extracted_values):
        """
        Ejecuta acciones automáticas según tipo:
        - Receta → crea Medication, notifica familia
        - Orden → crea Appointment, recuerda fecha
        - Resultado → analiza valores, alerta si crítico
        """
```

**Dependencias:** 
- `llm_integration.py` para clasificación con Claude (más potente que regex)
- `medical_ontology.py` para diccionarios de medicamentos, valores normales
- `unit_normalization.py` para convertir unidades

### 4.2 Frontend: UX Ultra-Simple

**Archivo:** `frontend/src/components/DocumentUploadWizard.jsx`

```jsx
/**
 * Flujo de 3 pasos para usuario no técnico:
 * 
 * 1. TOMAR FOTO / SUBIR ARCHIVO
 *    - Botón GRANDE: "Tomar foto con cámara"
 *    - Alternativa: "Seleccionar archivo"
 *    - No pedir metadata manualmente
 * 
 * 2. REVISIÓN AUTOMÁTICA (mientras se procesa)
 *    - Spinner: "Analizando documento..."
 *    - Muestra qué detección: "📋 Parece ser una receta"
 *    - Si hay duda: "¿Es esto una receta?" [Sí] [No, es...]
 * 
 * 3. RESUMEN AMIGABLE
 *    - Título grande: "Medicamento agregado"
 *    - Icono: ✓ o ⚠️ o 🚨 según alertas
 *    - Texto simple: "Paracetamol 500mg cada 8 horas"
 *    - Si hay alerta: "⚠️ Tu presión está alta, considera hablar con tu médico"
 *    - Botón: "Listo" o "Ver más detalles"
 */
```

### 4.3 API Nueva: Subida y Procesamiento

**Endpoints nuevos:**

```
POST /documents/upload/smart
  - Parámetro: file (imagen/PDF)
  - Respuesta: {
      document_id,
      detected_type,
      detected_subtype,
      extracted_values: [...],
      alerts: [...],
      next_action: "medicamento_agregado|cita_creada|revision_requerida"
    }

POST /documents/{id}/confirm-classification
  - Si usuario corrige la clasificación automática

GET /documents/{id}/analysis
  - Retorna análisis completo con alertas y tendencias

GET /documents/timeline/{profile_id}
  - Timeline de documentos procesados (para ver evolución)
```

---

## 5. FLUJOS ESPECÍFICOS POR TIPO

### 5.1 RECETA

```
Entrada: Foto/PDF de receta
    ↓
Clasificación: "receta" + subtype: "receta_simple|receta_controlada"
    ↓
Extracción:
  - Medicamento: Nombre, dosis, frecuencia
  - Especialista: Nombre (si aparece)
  - Fecha: De la receta
    ↓
Validación:
  - ¿Medicamento existe en BD?
  - ¿Dosis es razonable? (no >máximo)
  - ¿Es controlada? (avisar si sí)
    ↓
Acciones automáticas:
  1. Crear/actualizar Medication
  2. Enviar notificación familia: "Nuevo medicamento: Paracetamol"
  3. Si es controlada: "⚠️ Medicamento controlado, requerirá control"
  4. Sugerir recordatorio (si toma regularmente)
    ↓
Resultado usuario:
  ✓ "Paracetamol 500mg agregado"
  "Recordatorio: cada 8 horas"
  [Botón] "Ir a mis medicamentos"
```

### 5.2 RESULTADO DE LABORATORIO

```
Entrada: Foto/PDF de resultado de laboratorio
    ↓
Clasificación: "resultado" + subtype: "resultado_laboratorio"
    ↓
Extracción:
  - Valores: Hemoglobina, glucosa, colesterol, etc.
  - Fechas: De cuándo se hizo
  - Centro: Laboratorio
  - Rangos de referencia
    ↓
Validación:
  - Comparar con rangos normales (edad/sexo del usuario)
  - Comparar con último resultado (¿está mejorando/empeorando?)
  - Detectar valores CRÍTICOS
    ↓
Acciones automáticas:
  1. Si valor CRÍTICO: Alerta urgente (roja)
     "🚨 Tu glucosa está muy alta (450). Contacta a tu médico HOY"
  2. Si valor anormal pero no crítico:
     "⚠️ Tu hemoglobina está baja (10.2). Considera revisar con médico"
  3. Si todo normal:
     "✓ Todos tus valores están normales"
    ↓
Resultado usuario:
  📊 "Resultado de laboratorio agregado"
  - Hemoglobina: 12.5 g/dL ✓ Normal
  - Glucosa: 120 mg/dL ⚠️ Ligeramente elevada
  - Colesterol: 180 mg/dL ✓ Normal
  
  [Gráfica de tendencia si hay histórico]
```

### 5.3 ORDEN MÉDICA

```
Entrada: Foto/PDF de orden médica
    ↓
Clasificación: "orden" + subtype: "orden_examen|orden_procedimiento"
    ↓
Extracción:
  - Tipo de examen: Radiografía, tomografía, análisis, etc.
  - Fecha sugerida
  - Centro referido
  - Especialista que refiere
    ↓
Validación:
  - ¿Examen es válido/conocido?
  - ¿Hay vigencia (ej: órdenes valen 30 días)?
    ↓
Acciones automáticas:
  1. Crear Appointment (tipo "examen_programado")
  2. Recordatorio: "Tienes radiografía en 5 días"
  3. Notificar familia: "Nueva orden de radiografía de tórax"
    ↓
Resultado usuario:
  📋 "Cita de examen creada"
  "Radiografía de tórax"
  "Sugerida para: próximo martes"
  [Botón] "Ir a mis citas"
```

---

## 6. UX PARA ADULTOS MAYORES

### Principios:
- ✓ Botones GRANDES (mínimo 44px)
- ✓ Texto sin jerga médica
- ✓ Colores claros: ✓ verde, ⚠️ naranja, 🚨 rojo
- ✓ Iconos grandes + texto (no solo iconos)
- ✓ Confirmación en cada paso (sin hacer cosas "mágicas")
- ✓ Opción para hablar con familia: "Llamar a mi hijo"

### Pantalla de Subida:

```
┌─────────────────────────────────────────┐
│  📷 TOMAR UNA FOTO DEL DOCUMENTO      │
│                                         │
│    [   CÁMARA   ]    [   GALERÍA   ]  │ ← Botones 60px
│                                         │
│  Puedo ser foto del documento, PDF,    │
│  o cualquier archivo médico.           │
│                                         │
│  ¿Necesitas ayuda?                      │
│  [LLAMAR A MI HIJO]  [CONTACTAR SOPORTE]│
└─────────────────────────────────────────┘
```

### Pantalla de Resultado:

```
┌─────────────────────────────────────────┐
│         ✓ MEDICAMENTO AGREGADO          │
│                                         │
│  Paracetamol 500 mg                    │
│  Cada 8 horas (cada día)               │
│                                         │
│  Recordatorio activado:                │
│  Te avisaré a las 8:00, 16:00, 00:00  │
│                                         │
│  [   LISTO   ]                         │
│  [VER DETALLES]                        │
└─────────────────────────────────────────┘
```

---

## 7. PLAN DE IMPLEMENTACIÓN

### Fase 1: Backend Core (2-3 semanas)
- [x] Ampliar modelos de BD (DocumentTypeClassification, DocumentExtractedValue, etc)
- [x] Implementar DocumentIntelligenceEngine con:
  - Clasificación avanzada (usar Claude API para mejor precisión)
  - Extracción de valores (regex + NLP)
  - Validación contra rangos
  - Detección de alertas
- [x] Tests unitarios para cada función

### Fase 2: Automaciones y Flujos (2 semanas)
- [x] Ejecutar flujos específicos por tipo
- [x] Crear Medication, Appointment, Alerts automáticamente
- [x] Integración con notificaciones

### Fase 3: Frontend UX (2 semanas)
- [x] DocumentUploadWizard con 3 pasos
- [x] Pantalla de resultado amigable
- [x] Timeline de documentos

### Fase 4: API y Refinamiento (1 semana)
- [x] Endpoints POST/GET para subida y análisis
- [x] Tests E2E
- [x] Optimización de rendimiento

### Fase 5: Accesibilidad para Adultos Mayores (1 semana)
- [x] Aumentar tamaños
- [x] Simplificar lenguaje
- [x] Testing con usuarios reales

---

## 8. CASOS DE USO POR USUARIO

### Usuario: María (75 años, poca tecnología)
```
1. Recibe receta del médico en papel
2. Abre Klinip, presiona "Tomar foto"
3. Toma foto de receta
4. App detecta automáticamente: "Receta de Paracetamol"
5. María ve: "✓ Medicamento agregado. Recordatorio cada 8 horas"
6. Klinip notifica a su hijo: "Tu mamá tiene nuevo medicamento"
```

### Usuario: Carlos (55 años, entiende tecnología)
```
1. Se hace análisis de sangre
2. Le envían el resultado por email (PDF)
3. Abre Klinip, presiona "Subir archivo"
4. Selecciona PDF
5. App extrae valores, compara con histórico
6. Muestra: "Glucosa está alta (120), era 95 hace 2 meses"
7. "⚠️ Considera hablar con tu médico"
8. App crea recordatorio para contactar doctor
```

### Casos Complejos: Médico/Especialista
```
- Sube orden de múltiples exámenes
- Klinip identifica cada uno y crea citas separadas
- O múltiples medicamentos en una receta
- Klinip crea todos y avisa si hay interacciones peligrosas
```

---

## 9. TECNOLOGÍAS Y DEPENDENCIAS

### Backend:
- Claude API (para clasificación avanzada)
- Tesseract OCR (existente)
- regex + spacy para extracción (valores, medicamentos)
- Medical data: bases de datos de medicamentos, rangos de laboratorio

### Frontend:
- React 18 (existente)
- react-camera-pro (para tomar fotos)
- react-pdf (para visor)
- chart.js (para tendencias)

---

## 10. MÉTRICAS DE ÉXITO

- [ ] 90%+ precisión en clasificación de documentos
- [ ] <2 segundos para procesar documento (OCR + análisis)
- [ ] 95%+ de medicamentos identificados correctamente
- [ ] 0 falsos negativos en valores críticos
- [ ] Adultos mayores pueden subir documento en <30 segundos
- [ ] 100% de documentos guardados en sección correcta

---

## 11. RIESGOS Y MITIGACIÓN

| Riesgo | Impacto | Mitigación |
|--------|---------|-----------|
| OCR falla con documentos de baja calidad | Alto | Mejorar preprocesamiento, permitir edición manual |
| Clasificación incorrecta | Alto | Validación del usuario, review semanal |
| Valores críticos no detectados | Crítico | Testing exhaustivo, alertar a médico/familia |
| Falsos positivos en alertas | Medio | Rangos conservadores, educación del usuario |
| Sobreabundancia de notificaciones | Medio | Configuración de preferencias |

---

## PRÓXIMOS PASOS

1. **Validar arquitectura** con equipo médico
2. **Implementar Fase 1** (modelos + engine)
3. **Testing** con datos reales de usuarios
4. **Iterar** basado en feedback
5. **Lanzar MVP** con subida de recetas + medicamentos

---

*Documento creado: 2026-06-13*
*Versión: 1.0 - Diseño Inicial*
