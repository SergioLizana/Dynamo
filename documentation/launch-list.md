# Lanzar una lista de tickets con el workflow

El workflow `run-list` (`.claude/workflows/run-list.js`) construye una lista de tickets sin intervenir: lee el
estado en GitHub, construye cada ticket listo en su propia copia, lo revisa con el `reviewer`, fusiona de uno en uno
en la rama de trabajo y bloquea o salta lo que toque. Los datos del proyecto los lee de `.claude/factory.md`. Es el
diseño de `documentation/workflow-trial.md`; mientras exista la skill `/run`, se llama `run-list`.

## Antes de lanzar

- Workflows activados en `/config` (en el plan Pro vienen apagados).
- `"worktree": { "baseRef": "head" }` en `.claude/settings.json`: las copias salen del checkout actual.
- La carpeta principal, en la rama de trabajo y sin cambios en lo rastreado (las copias de `.claude/worktrees/` no
  cuentan): ahí se fusiona. Si no, el workflow se para en *Frontier* y dice por qué.

## Lanzar

En una sesión normal de Claude Code, abierta en la raíz del repositorio:

```text
/run-list 34 35
```

O, con otras palabras, «Lanza /run-list con los tickets 34 y 35». Claude le pasa los números como `args`. Sin
números, toma todos los issues abiertos sin la etiqueta de hecho ni la de bloqueado. Para otra base:
«Lanza /run-list con los tickets 34 y 35 y base `release/0.0.0-prueba`» (`args = { tickets, base }`).

La primera vez, Claude Code pide permiso para lanzar el workflow (en modo `auto`, solo la primera vez). Una orden que
necesite permiso a mitad de ejecución se le pregunta al humano, y ese agente espera.

## Seguirla

`/workflows` abre la vista de la ejecución: las fases *Frontier*, *Build*, *Review* y *Merge*, cada agente con sus
llamadas, su resultado y sus tokens. `p` pausa o reanuda, `x` para un agente o la ejecución entera. También se ve una
línea de progreso en el panel de tareas, debajo de la entrada.

Al acabar, el workflow devuelve por ticket: hecho (con el commit de fusión), bloqueado (con el motivo) o saltado.
También devuelve las copias quitadas, las que se quedan y las ramas que tiene que borrar el humano. El estado de
verdad está en GitHub: la etiqueta, la tarjeta y el comentario de cada ticket.

## Cómo decide

- **Modelos:** Haiku con `effort: high` en *Frontier*, *Build* y *Merge* (`run-list.js:17`); el `reviewer` con
  `agentType: 'reviewer'` y el modelo de su definición, Opus (`run-list.js:269`).
- **Tope de 2 vueltas:** `run-list.js:18` y `:251`; si se agotan, bloqueado (`:263` comprobación, `:273` revisor).
- **Espera a los bloqueadores:** cada ticket espera a los de la lista (`run-list.js:243`). Un bloqueador de fuera de
  la lista tiene que estar ya cerrado o hecho; si no, el ticket se salta (`:239`).
- **Salto de los dependientes de un bloqueado:** «saltado: depende de #n, que no llegó a la release» (`:246`), sin
  etiqueta y con la tarjeta donde estaba.
- **Lo que pide una casilla fuera del código:** lo publica *Build* durante su paso (`run-list.js:177`); *Merge*
  publica solo el informe final y no lo repite (`:291` y `:293`).

## Fallos del ensayo, arreglados

Los fallos 1-5 de `documentation/workflow-trial.md`:

1. **No limpia todo:** al acabar, un agente quita todas las copias de la ejecución, de todas las vueltas (salvo la de
   un ticket bloqueado sin commit, que guarda el único trabajo) y lista las ramas que quedan para que las borre el
   humano, porque borrar ramas pide permiso (`run-list.js:322` y `:330-333`).
2. **Historial sucio en la segunda vuelta:** la vuelta 2 trae la vuelta 1 con `git cherry-pick`, y solo si
   `git log <base>..<rama>` lista commits (`run-list.js:161` y `:165-166`).
3. **Una segunda vuelta que no sirve:** si *Build* dice que el ticket necesita al humano, se bloquea sin segunda
   vuelta (`run-list.js:257-258`).
4. **Afirmaciones sin comprobar:** todo hecho sale de una orden ejecutada en ese paso, nunca «HEAD of …»
   (`run-list.js:21` y `:29`), y un commit tiene que ser un sha (`:32-33`).
5. **Órdenes compuestas:** una orden por llamada y tarjetas movidas por la URL del issue, sin `move_card`
   (`run-list.js:20` y `:24`).

## Sin probar

El guion no se ha ejecutado todavía con tickets reales: su primera prueba es la próxima lista. Siguen sin probar lo
que el ensayo dejó pendiente (choque al fusionar, comprobación que falla tras fusionar, permiso a mitad de ejecución,
pausa por límite de uso) y que *Frontier* reciba bien `args` desde `/run-list`.
