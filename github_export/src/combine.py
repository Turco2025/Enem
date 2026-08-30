import json

with open("/home/claude/enem/app_template.html", encoding="utf-8") as f:
    template = f.read()

with open("/home/claude/enem/app_data.json", encoding="utf-8") as f:
    app_data_raw = f.read()

with open("/home/claude/enem/app.js", encoding="utf-8") as f:
    app_js = f.read()

# app_data.json is already valid JSON text; embed verbatim as a JS literal.
app_data_js = app_data_raw.replace("</script", "<\\/script")
app_js_safe = app_js.replace("</script", "<\\/script")

out = template.replace("__APP_DATA__", app_data_js).replace("__APP_JS__", app_js_safe)

with open("/home/claude/enem/deliverables/Gerador_Simulados_ENEM.html", "w", encoding="utf-8") as f:
    f.write(out)

print("ok", len(out))
