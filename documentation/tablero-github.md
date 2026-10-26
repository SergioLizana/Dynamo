# Tickets en GitHub: bloqueos, «hecho» y tablero

Probado el 2026-10-26 sobre `SergioLizana/Dynamo` (ticket #1). Plantilla: `.claude/templates/ticket.md`.
Estados y significado: plan §6.5.

## Bloqueado por

La relación **nativa** de GitHub es la fuente de verdad. La sección «Bloqueado por» del cuerpo es solo para leer.

```bash
# id interno (no el número) del bloqueador
ID=$(gh api repos/SergioLizana/Dynamo/issues/<bloqueador> --jq .id)
gh api -X POST repos/SergioLizana/Dynamo/issues/<n>/dependencies/blocked_by -F issue_id=$ID
gh api repos/SergioLizana/Dynamo/issues/<n>/dependencies/blocked_by --jq '.[]|{number,state}'
```

Comprobado:
- Un bloqueador cerrado **sigue en la lista** con `state: closed`. `issueDependenciesSummary.blockedBy` (GraphQL)
  cuenta solo los abiertos.
- El proyecto no tiene un campo «Blocked by»: el bloqueo se ve en la página del issue, no como columna del tablero.
  No he podido comprobar por la CLI si la interfaz web lo muestra en la tarjeta.

## Hecho en release

GitHub solo cierra issues al fusionar en `main`, y los tickets se fusionan en `release/x.y.z`. Decisión:

- Al fusionar el ticket en la release: etiqueta **`hecho-en-release`** y tarjeta en *Done*. El issue **sigue abierto**.
- «Cerrado» significa «en `main`». El PR de la release lleva `Closes #n` por cada ticket para que GitHub los cierre solo.
  *No probado*: exige fusionar en `main`, que no se hace sin tu autorización.
- Frontera de `/run` (la define y prueba `/run`, etapa 3; aquí solo la regla de marcado): issues abiertos sin
  `hecho-en-release` cuyos bloqueadores la tengan o estén cerrados.
- `bloqueado` (ticket atascado) es otra etiqueta y no cambia el estado de la tarjeta.

```bash
gh issue edit <n> -R SergioLizana/Dynamo --add-label hecho-en-release
```

## Mover una tarjeta

```bash
move_card() { # $1 = nº de issue, $2 = id de la opción
  ITEM=$(gh project item-list 1 --owner SergioLizana --limit 100 --format json \
    --jq ".items[]|select(.content.number==$1)|.id")
  gh project item-edit --id "$ITEM" --project-id PVT_kwHOAbB1zs4BoyYk \
    --field-id PVTSSF_lAHOAbB1zs4BoyYkzhnQ1FA --single-select-option-id "$2"
}
```

| Dato | Identificador |
|---|---|
| Proyecto (`SergioLizana`, nº 1) | `PVT_kwHOAbB1zs4BoyYk` |
| Campo Status | `PVTSSF_lAHOAbB1zs4BoyYkzhnQ1FA` |
| Todo | `7e5c5ff3` |
| In Progress | `a41ae146` |
| Verify | `a243ce09` |
| In Review | `7eccea7a` |
| Done | `e617f390` |

Probado: Todo → In Progress → Verify → In Review → In Progress → In Review → Done. Si se renombra o recrea un estado,
se vuelven a leer con `gh project field-list 1 --owner SergioLizana --format json`.
