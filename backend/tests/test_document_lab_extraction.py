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


def test_table_fallback_skips_reference_range_boundary_as_value():
    # Regresión: en un diferencial de hemograma, cuando el resultado de un
    # tipo celular raro es 0/ausente y no se imprime, solo queda visible el
    # rango de referencia ("0 - 25"). Sin el resguardo, el parser tomaba el
    # limite superior del rango como si fuera el resultado medido, repitiendo
    # el mismo numero en varias filas distintas (ej. "25 mg/dl" en 6 tipos
    # celulares diferentes que no pueden tener todos el mismo valor real).
    text = (
        "Parametro        Resultado   U.Medida   Valor Referencia\n"
        "PROMIELOCITOS    0    -    25    %\n"
        "MIELOCITOS       0    -    25    %\n"
        "JUVENILES        0    -    25    %\n"
    )
    entities = main._extract_document_lab_entities(text)
    # Ninguna fila debe generar un valor inventado: es mejor omitirlas que
    # reportar un numero que no corresponde al resultado real.
    assert entities == []


def test_table_fallback_still_reads_genuine_result_next_to_a_range():
    text = (
        "Parametro     Resultado   U.Medida   Valor Referencia\n"
        "EOSINOFILOS   3           %           0    -    25\n"
    )
    entities = main._extract_document_lab_entities(text)
    assert len(entities) == 1
    assert entities[0]["entity_name"] == "EOSINOFILOS"
    assert entities[0]["entity_value"] == "3"
    assert entities[0]["unit"] == "%"


def test_vision_examenes_convert_to_lab_entities():
    examenes = [
        {"nombre": "Glucosa", "valor": "95", "unidad": "mg/dL", "rango": "70-100", "estado": "normal"},
        {"nombre": "Colesterol total", "valor": "220", "unidad": "mg/dL", "rango": "0-200", "estado": "alto"},
    ]
    entities = main._vision_exams_to_lab_entities(examenes)
    assert len(entities) == 2
    assert entities[0]["entity_type"] == "lab_value"
    assert entities[1]["flag"] == "high"


def test_vision_examenes_keeps_same_name_in_different_sections():
    # Regresión: el mismo parámetro puede repetirse en más de una sección de
    # un informe multi-hoja con significados distintos (glucosa en sangre vs.
    # en orina). Antes se descartaba la segunda fila por comparar solo el
    # nombre; ahora ambas se conservan y se distinguen con la sección.
    examenes = [
        {"nombre": "GLUCOSA", "valor": "108", "unidad": "mg/dL", "rango": "70-100", "estado": "alto", "seccion": "Plasma"},
        {"nombre": "GLUCOSA", "valor": "Normal", "unidad": "", "rango": "", "estado": "normal", "seccion": "Orina aislada"},
        {"nombre": "GLUCOSA", "valor": "108", "unidad": "mg/dL", "rango": "70-100", "estado": "alto", "seccion": "Plasma"},
    ]
    entities = main._vision_exams_to_lab_entities(examenes)
    # La tercera fila es un duplicado exacto de la primera (mismo nombre,
    # valor y unidad) y sí debe descartarse.
    assert len(entities) == 2
    names = {item["entity_name"] for item in entities}
    assert "GLUCOSA (Plasma)" in names
    assert "GLUCOSA (Orina aislada)" in names


def test_vision_examenes_cap_raised_to_80():
    # Regresión: un informe de laboratorio de varias hojas (coagulación,
    # química, orina, hematología) puede traer 50+ parámetros; el tope
    # anterior de 40 los truncaba en silencio.
    examenes = [
        {"nombre": f"Parametro {i}", "valor": str(i), "unidad": "mg/dL", "rango": "0-10", "estado": "normal"}
        for i in range(60)
    ]
    entities = main._vision_exams_to_lab_entities(examenes)
    assert len(entities) == 60


def test_table_fallback_reads_qualitative_urine_values():
    # Regresión: un examen de orina completa trae resultados no numéricos
    # (Negativo, Trazas, +) que antes se descartaban por completo porque el
    # parser de tabla exigía un token numérico como "resultado".
    text = (
        "Parametro           Resultado          Valor Referencia\n"
        "LEUCOCITOS           Negativo           NEGATIVO (< 10 Leu/uL)\n"
        "UROBILINOGENO        Normal             NORMAL (< 1 mg/dL)\n"
        "CUERPOS CETONICOS    Trazas             NEGATIVO (< 5 mg/dL)\n"
        "GLOBULOS ROJOS       +                  NEGATIVO\n"
    )
    entities = main._extract_lab_table_entities(text)
    by_name = {item["entity_name"]: item for item in entities}

    assert by_name["LEUCOCITOS"]["entity_value"] == "Negativo"
    assert by_name["LEUCOCITOS"]["flag"] == "normal"

    assert by_name["UROBILINOGENO"]["entity_value"] == "Normal"
    assert by_name["UROBILINOGENO"]["flag"] == "normal"

    assert by_name["CUERPOS CETONICOS"]["entity_value"] == "Trazas"
    assert by_name["CUERPOS CETONICOS"]["flag"] == "abnormal"

    assert by_name["GLOBULOS ROJOS"]["entity_value"] == "+"
    assert by_name["GLOBULOS ROJOS"]["flag"] == "abnormal"
    # Los valores cualitativos no deben heredar una "unidad" falsa desde la
    # columna de referencia (ej. tomar "NEGATIVO" como si fuera unidad).
    assert by_name["LEUCOCITOS"]["unit"] == ""


def test_table_split_survives_safe_text_whitespace_collapse():
    # Regresión clave: _extract_lab_table_entities dividía columnas después
    # de pasar la línea por _safe_text, que colapsa cualquier corrida de 2+
    # espacios a uno solo. _split_table_row depende de esas corridas para
    # separar celdas, así que en la práctica NUNCA dividía nada: la fila
    # completa quedaba como una sola columna y se descartaba. Esto explica
    # por qué un informe de varias hojas con decenas de filas solo aportaba
    # 1-2 valores (los que además calzaban con la regex de una sola línea).
    line = "BILIRRUBINA INDIRECTA           0.55"
    assert main._split_table_row(line) == ["BILIRRUBINA INDIRECTA", "0.55"]
    text = (
        "Parametro           Resultado          U.Medida     Valor Referencia\n"
        f"{line}\n"
    )
    entities = main._extract_lab_table_entities(text)
    assert len(entities) == 1
    assert entities[0]["entity_name"] == "BILIRRUBINA INDIRECTA"
    assert entities[0]["entity_value"] == "0.55"


def test_extract_document_lab_entities_reads_multi_section_report():
    # Simula un informe multi-hoja real (coagulación + química + orina +
    # hematología combinadas en un solo documento): varias tablas con su
    # propio encabezado repetido "Parametro/Resultado/...", filas sin unidad
    # ni rango, y resultados cualitativos de orina.
    text = (
        "Parametro     Resultado   U.Medida   Valor Referencia\n"
        "SEGUNDOS      11.3        seg\n"
        "PORCENTAJE    85          %           [70 - 120]\n"
        "\n"
        "Parametro           Resultado          U.Medida     Valor Referencia\n"
        "BILIRRUBINA INDIRECTA           0.55\n"
        "CREATININA                      1.10          mg/dL        [0.66 - 1.25]\n"
        "\n"
        "Parametro           Resultado          Valor Referencia\n"
        "LEUCOCITOS           Negativo           NEGATIVO (< 10 Leu/uL)\n"
        "CUERPOS CETONICOS    Trazas             NEGATIVO (< 5 mg/dL)\n"
    )
    entities = main._extract_document_lab_entities(text)
    names = {item["entity_name"] for item in entities}
    assert {"SEGUNDOS", "PORCENTAJE", "BILIRRUBINA INDIRECTA", "CREATININA", "LEUCOCITOS", "CUERPOS CETONICOS"} <= names


def test_extract_document_lab_entities_disambiguates_same_name_across_sections():
    # Regresión: "GLUCOSA" aparece en la sección de sangre (Plasma) y de
    # nuevo en orina, con significados distintos. Antes se perdía la segunda
    # por deduplicarse solo por nombre; ahora ambas se conservan y se anota
    # la sección de cada una en el nombre.
    text = (
        "Muestra: Plasma\n"
        "Parametro     Resultado   U.Medida   Valor Referencia\n"
        "GLUCOSA       108         mg/dL      [70 - 100]\n"
        "\n"
        "Muestra: Orina aislada\n"
        "Parametro           Resultado          Valor Referencia\n"
        "GLUCOSA              Normal             NEGATIVO\n"
        "LEUCOCITOS           Negativo           NEGATIVO (< 10 Leu/uL)\n"
        "\n"
        "Muestra: Sangre/EDTA\n"
        "Parametro           Resultado   U.Medida     Valor Referencia\n"
        "HEMATOCRITO          44.4        %            [41 - 53]\n"
    )
    entities = main._extract_document_lab_entities(text)
    by_name = {item["entity_name"]: item for item in entities}
    assert by_name["GLUCOSA (Plasma)"]["entity_value"] == "108"
    assert by_name["GLUCOSA (Orina aislada)"]["entity_value"] == "Normal"
    # LEUCOCITOS solo aparece una vez: no debe llevar sufijo de sección.
    assert "LEUCOCITOS" in by_name


def test_repair_truncated_json_salvages_complete_examenes():
    # Regresión: la respuesta de visión se corta a mitad del array "examenes"
    # cuando el documento es largo (limite de tokens del modelo). Antes,
    # _parse_json_object descartaba TODA la respuesta ante cualquier JSON
    # invalido; ahora rescata los elementos completos antes del corte.
    truncated = (
        '{"tipo": "resultado", "examenes": ['
        '{"nombre": "SEGUNDOS", "valor": "11.3", "unidad": "seg", "rango": "", "estado": "normal"}, '
        '{"nombre": "PORCENTAJE", "valor": "85", "unidad": "%", "rango": "70-120", "estado": "normal"}, '
        '{"nombre": "INR", "valor": "1.00", "unidad": "", "rango": '
    )
    parsed = main._parse_json_object(truncated)
    assert parsed is not None
    assert parsed["tipo"] == "resultado"
    examenes = parsed["examenes"]
    assert len(examenes) == 2
    assert examenes[0]["nombre"] == "SEGUNDOS"
    assert examenes[1]["nombre"] == "PORCENTAJE"


def test_repair_truncated_json_returns_none_when_nothing_complete():
    assert main._parse_json_object('{"tipo": "resultado", "examenes": [{"nombre": "SEG') is None
