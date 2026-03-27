# Prevencion de caracteres corruptos (UTF-8)

> Este archivo define reglas practicas para evitar mojibake y corrupcion de texto en el proyecto.

---

## Por que aparecen secuencias rotas de UTF-8

Eso pasa cuando bytes UTF-8 se leen como Latin-1 u otra codificacion incorrecta.
Una tilde, una comilla tipografica o un emoji usan varios bytes en UTF-8.
Si algun paso de la cadena los interpreta con otra codificacion, el texto termina roto.

---

## Reglas obligatorias

### Python: siempre usar encoding explicito

```python
# Incorrecto
open("archivo.txt", "r")

# Correcto
open("archivo.txt", "r", encoding="utf-8")
open("archivo.txt", "w", encoding="utf-8")
```

### Python: configurar stdout y stderr en UTF-8

Agregar al arranque del backend:

```python
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")
```

### Frontend: declarar charset en `index.html`

El primer meta dentro de `<head>` debe ser:

```html
<meta charset="UTF-8" />
```

### Strings del codigo

- No copiar texto desde fuentes con encoding roto.
- No dejar strings hardcodeados con mojibake.
- Si un texto interno no necesita tildes, ASCII simple es una opcion segura.

---

## Configuracion del proyecto

### `.editorconfig`

Mantener en la raiz:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
insert_final_newline = true
trim_trailing_whitespace = true
```

### `AGENTS.md`

Debe recordar estas reglas:

- Guardar archivos en UTF-8 sin BOM
- Usar `encoding="utf-8"` al leer o escribir texto en Python
- No introducir mojibake en strings o contenido visible
- Escribir archivos generados en UTF-8 explicito
- Configurar salida del servidor en UTF-8

---

## Como diagnosticar un archivo roto

```bash
# Validar lectura UTF-8 en Python
python -c "open('archivo.py', encoding='utf-8').read(); print('OK')"
```

Si falla, el archivo probablemente esta guardado con otra codificacion o ya contiene texto corrupto.

---

## Checklist antes de cada deploy

- Verificar que exista `.editorconfig` con `charset = utf-8`
- Verificar que `index.html` tenga `<meta charset="UTF-8" />`
- Verificar que cualquier `open()` de texto use `encoding="utf-8"`
- Verificar que stdout y stderr del backend queden en UTF-8 al arranque
- Revisar textos nuevos para detectar mojibake antes de hacer commit

---

## Resumen rapido

- UTF-8 debe ser el estandar del repo
- Latin-1 suele ser la causa del mojibake
- El encoding explicito evita corrupcion futura
- Corregir archivos rotos no reemplaza la prevencion
