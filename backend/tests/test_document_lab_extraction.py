"""Extracción de valores de laboratorio desde texto OCR de tablas.

Regresión: los informes de laboratorio chilenos (Parámetro | Resultado |
U.Medida | Valor Referencia | Resultado Anterior) rompían la regex de una
sola línea; el documento quedaba guardado pero sin valores en la Ficha de
Salud. `_extract_document_lab_entities` ahora intenta un segundo parseo
tolerante a columnas cuando la extracción lineal encuentra pocos valores.
"""

from app import main


SAMPLE_LAB_TABLE_TEXT = """Unidad Laboratorio Clinico
Nuestra Nueva Nunoa

PACIENTE: CASTRO LAGOS DIEGO
Parametro     Resultado   U.Medida   Valor Referencia   Resultado Anterior
TIEMPO DE PROTROMBINA (TP)
SEGUNDOS      11.3        seg
PORCENTAJE    85          %           [70 - 120]
INR           1.00                    [0.8 - 1.2]

Metodo: Nefelometria
"""


def test_extracts_values_from_table_layout():
    entities = main._extract_document_lab_entities(SAMPLE_LAB_TABLE_TEXT)
    by_name = {item["entity_name"]: item for item in entities}

    assert "SEGUNDOS" in by_name
    assert by_name["SEGUNDOS"]["entity_value"] == "11.3"
    assert by_name["SEGUNDOS"]["unit"] == "seg"

    assert "PORCENTAJE" in by_name
    assert by_name["PORCENTAJE"]["entity_value"] == "85"
    assert by_name["PORCENTAJE"]["unit"] == "%"
    assert by_name["PORCENTAJE"]["reference_range"] == "70-120"
    assert by_name["PORCENTAJE"]["flag"] == "normal"

    assert "INR" in by_name
    assert by_name["INR"]["entity_value"] == "1.00"
    assert by_name["INR"]["reference_range"] == "0.8-1.2"


def test_table_fallback_flags_abnormal_values():
    text = (
        "Parametro   Resultado   U.Medida   Valor Referencia\n"
        "GLUCOSA     180         mg/dl       [70 - 100]\n"
    )
    entities = main._extract_document_lab_entities(text)
    assert len(entities) == 1
    assert entities[0]["entity_name"] == "GLUCOSA"
    assert entities[0]["flag"] == "high"


def test_table_fallback_skips_when_no_lab_header():
    text = "Hola, este es un texto cualquiera sin formato de tabla clinica.\nOtra linea normal aca.\n"
    entities = main._extract_document_lab_entities(text)
    assert entities == []


def test_table_fallback_does_not_misread_clinical_notes_as_values():
    # Regresión: aunque el texto mencione "parametro"/"resultado" de forma
    # genérica (falso positivo de _looks_like_lab_table), una frase clínica
    # larga con espacios anchos de OCR no debe leerse como un valor de
    # laboratorio (ej. "Paciente refiere gonalgia..." con un numero suelto).
    text = (
        "Evaluacion medica: revise el parametro clinico y el resultado del reposo\n"
        "Paciente refiere gonalgia izquierda de evolucion   1   sin trauma previo\n"
        "REPOSO: 1 mes\n"
    )
    entities = main._extract_document_lab_entities(text)
    assert entities == []


def test_vision_examenes_convert_to_lab_entities():
    examenes = [
        {"nombre": "Glucosa", "valor": "95", "unidad": "mg/dL", "rango": "70-100", "estado": "normal"},
        {"nombre": "Colesterol total", "valor": "220", "unidad": "mg/dL", "rango": "0-200", "estado": "alto"},
    ]
    entities = main._vision_exams_to_lab_entities(examenes)
    assert len(entities) == 2
    assert entities[0]["entity_type"] == "lab_value"
    assert entities[1]["flag"] == "high"
