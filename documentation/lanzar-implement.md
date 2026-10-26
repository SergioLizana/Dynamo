# Lanzar /implement sin intervenir

`/implement` corre desatendido con `claude -p`: nadie responde a los avisos de permiso, así que lo que no está
permitido se deniega. Los permisos están en `.claude/settings.json` (lista blanca y lista negra; lo negado gana).
Lo que no está en ninguna lista lo decide el modo `auto`; con `--permission-prompts none`, lo que preguntaría se
deniega.

Desde PowerShell, en `E:\Proyectos\Dynamo`, con el árbol limpio:

```powershell
$n = 12   # número del ticket
$r = claude -p "/implement $n" --output-format json --max-budget-usd 5 --permission-mode auto --permission-prompts none | ConvertFrom-Json
gh issue comment $n -R SergioLizana/Dynamo --body "Métricas de /implement: $($r.num_turns) turnos · $([math]::Round($r.total_cost_usd, 2)) USD · $($r.subtype)"
```

- `num_turns` y `total_cost_usd` salen del JSON de `claude -p`: la sesión no conoce su propio coste.
- `subtype` es `success` o el motivo de corte (`error_max_budget_usd`, `error_max_turns`…).
- Tope de coste por ticket: 5 USD para empezar; se ajusta tras los 3 primeros tickets (plan §10.6).
- Para probar sobre otra base: `"/implement $n release/0.0.0-prueba"`.
