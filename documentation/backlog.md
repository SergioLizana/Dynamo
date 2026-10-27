# Backlog

Ideas y riesgos que surgen por el camino y que no se convierten en ticket mientras no los pida un problema real
(plan §8.1). Cada entrada dice de dónde sale y qué hay comprobado.

## Proteger `main`

- **Origen:** revisión del #4 (2026-10-26). La lista negra de `.claude/settings.json` frena `git push` y los
  `gh api -X/--method`, pero `gh api <ruta> -f …` hace un POST implícito y `gh api graphql` admite mutaciones: una
  ejecución desatendida podría escribir en `main` por la API.
- **Comprobado:** con el plan Free y el repositorio privado, GitHub no deja proteger ramas ni crear reglas:
  `gh api repos/SergioLizana/Dynamo/branches/main/protection` → `403 Upgrade to GitHub Pro or make this repository
  public`; `.../rulesets` da lo mismo.
- **Opciones:** GitHub Pro; o que los agentes usen un token de grano fino con *Contents* en solo lectura (los agentes
  no necesitan escribir código en GitHub: fusionan en local), y *Issues* y *Projects* en escritura. Sin comprobar si
  un token de grano fino puede escribir en un Project de usuario.
- **Por qué no un agente `git-ops` aparte con más permisos** (pensado el 2026-10-26): las reglas `deny` valen para toda
  la sesión, subagentes incluidos, así que no se puede negar algo al Builder y permitírselo a otro agente sin un hook
  propio; las reglas sobre Bash no son una barrera (el Builder puede llamar a `git` desde otro programa), y ningún
  agente necesita hacer push: fusionan en local. El corte de verdad está en las credenciales de la ejecución
  desatendida:
  - `gh`: el token de grano fino de arriba, pasado como `GH_TOKEN` solo en el comando de lanzamiento;
  - `git push`: usa el gestor de credenciales de Windows, no `GH_TOKEN`; quitárselo a esa ejecución vaciando
    `credential.helper` con variables de entorno (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_VALUE_0`).
  - Sin comprobar ninguna de las dos. Tampoco es aislamiento completo (un agente con Bash en el mismo usuario podría
    llegar al gestor de credenciales): eso solo lo da un contenedor (plan §7 y §10.4).
- **Cuándo:** antes de dejar listas desatendidas (etapa 3).
- **Permisos distintos por agente** (consultado en `code.claude.com/docs/en/sub-agents.md` el 2026-10-27): la
  cabecera de un subagente admite `tools`, `disallowedTools`, `permissionMode` y `hooks`. No admite reglas `allow` ni
  `deny` propias: las de `settings.json` valen para toda la sesión, subagentes incluidos. `disallowedTools` quita la
  herramienta entera (`Bash(git push *)` quita todo Bash) y `permissionMode` se ignora si la sesión está en `auto`,
  como nuestras `-p`. Lo único que filtra comandos agente por agente es un hook `PreToolUse` en su cabecera, que
  solo corre mientras ese agente está activo. Sirve para recortar (un Builder sin push), nunca para dar a un agente
  más que a la sesión. Es una barrera de buena fe, como `deny`, y sería un comando propio que tiene que funcionar en
  Linux, macOS y Windows. Probarlo solo cuando un ticket necesite separar permisos entre agentes.
- **Push a `release/x.y.z`** (pensado el 2026-10-26): hoy `git push` está en `ask` (en sesión normal pregunta;
  en `-p` se deniega). No se pasa a `allow` porque ningún ticket lo necesita (se fusiona en local) y una regla como
  `Bash(git push origin release/*)` también deja pasar `git push origin release/0.1.0:main`, sin nada en GitHub que lo
  pare. Hará falta en la etapa 3b, cuando `/run` suba la release para abrir el PR contra `main`: decidirlo entonces
  junto con las credenciales (un token que solo empuje `release/*`) o GitHub Pro.

## Una identidad propia para los agentes

- **Origen:** revisión del #4. Todo lo que hacen los agentes (comentarios, etiquetas, edición de tickets) sale a
  nombre de `SergioLizana`: GitHub no distingue lo que hizo el humano de lo que hizo un agente.
- **Opciones:** una cuenta de máquina (sin comprobar las condiciones de GitHub para cuentas de este tipo) o una GitHub
  App. Un token de grano fino de la cuenta propia limita lo que puede hacer el agente, pero no cambia el autor.

## Copias de trabajo que salen de `main`

- **Origen:** pruebas del #17 (2026-10-26). `main` está en `cc2dc46` y no tiene `.claude/`
  (`git ls-tree main .claude` sale vacío). Las copias de un subagente con `isolation: worktree` y de `claude --bg`
  salen de ahí: trabajan sin skills, sin `settings.json` en la copia y sin el `reviewer`, y sobre código viejo.
- **Comprobado:** las tres copias de prueba de esas dos opciones estaban en `cc2dc46`. Los permisos sí se aplicaron,
  pero los de la sesión que las lanzó, no los de la copia.
- **Por qué `main`:** es el valor por defecto de `worktree.baseRef` (`"fresh"`, la rama principal del remoto), no
  el checkout actual (investigación §3.3). El humano esperaba que salieran de la rama sacada (2026-10-27).
- **Opciones:** `worktree.baseRef: "head"` (sin probar); o no usarlas y crear las copias con `git worktree add`, que
  es lo que recomienda `documentation/parallel-launch-trial.md`. El desfase se cierra solo cuando la release llegue a
  `main`.
- **Cuándo:** solo si `/run` acaba usando subagentes aislados o `--bg`.
- **Resuelto el 2026-10-27:** `worktree.baseRef: "head"` en `.claude/settings.json` (`d4a1a26`). Probado en los
  ensayos de `documentation/workflow-trial.md`: las copias salieron de la punta de la base, con `.claude/`.

## `.claude/worktrees/` fuera de `.gitignore`

- **Origen:** pruebas del #17. Las copias que crea Claude Code salen como `?? .claude/worktrees/` en
  `git status --porcelain`.
- **Riesgo:** un `git add -A` las metería en un commit. `/implement` ya prohíbe `-A`, y un `git status` sucio lo
  bloquea en el paso 0.
- **Cuándo:** si una copia acaba en un commit o bloquea un lanzamiento.

## Permisos de `git worktree` para `/run`

- **Origen:** pruebas del #17. `git worktree add` y `git worktree remove` no están en `.claude/settings.json`; en la
  sesión normal los decidió el modo `auto`. Con `claude -p --permission-prompts none` se denegarían si el modo no los
  aprueba.
- **Cuándo:** al escribir `/run` (#18), que los necesita para crear y borrar las copias.

## Borrado automático de las copias de subagente, sin ver

- **Origen:** revisión del #17. La tabla de `documentation/parallel-launch-trial.md` dice que la copia de un subagente
  se borra sola «si no cambia nada, ni de rama». Viene de la documentación (investigación §3.2): en las pruebas
  ninguna copia se borró sola, porque las dos tenían cambios o habían cambiado de rama.
- **Cuándo:** si `/run` llega a depender de esa limpieza.

## Etiqueta con la versión en lugar de `hecho-en-release`

- **Origen:** el humano, el 2026-10-27. `hecho-en-release` no dice en qué versión está el ticket.
- **Opciones:**
  - a) Renombrarla a `in-release`.
  - b) Una etiqueta por versión, `release-x.y.z` (GitHub admite puntos en el nombre). `/implement` y la frontera de
    `/run` tendrían que buscar un patrón (`release-*`) y no un nombre fijo, y hay que crear la etiqueta al abrir cada
    versión.
  - c) Un *milestone* `0.1.0`, lo que GitHub trae para esto: uno por issue, con barra de progreso y filtro en el
    tablero. Pero «está en la versión» no es «ya está fusionado»: seguiría haciendo falta la tarjeta en *Done* o una
    etiqueta para lo segundo.
- **Dónde se usa hoy:** `.claude/skills/implement/SKILL.md` (pasos 0 y 5), `.claude/skills/run/SKILL.md`, plan §6.5 y
  `documentation/github-board.md`.
- **Sin comprobar:** cómo filtra el tablero por milestone.

## Columnas *Blocked* y *Closed* en el tablero

- **Origen:** el humano, el 2026-10-27, al encontrar el #21 (ticket de prueba del #18) cerrado pero con la tarjeta en
  *Todo*. Quiere ver en el tablero, sin abrir cada ticket, cuándo le toca intervenir.
- **Qué choca:** el plan §6.5 decidió que un ticket atascado lleva la etiqueta `bloqueado` y no un estado, y
  `/implement` (paso 7) deja la tarjeta en el paso donde se paró. Una columna *Blocked* cambia las dos cosas, y
  `/run` también las usa.
- **Sin comprobar:** si el flujo integrado del proyecto («Item closed») puede mover sola la tarjeta a *Closed* al
  cerrar el issue. En el historial del #21 hay un `Todo -> Closed` y un `Closed -> Todo` el 2026-10-26 a las 23:46
  que nadie ha explicado, sin que exista una opción *Closed*.

## Dividir `/implement` en varios agentes

- **Origen:** el humano, el 2026-10-27: se suele leer que cada fase de una factoría lleva su agente, y hay
  orquestadores que son una skill que lanza subagentes (como `implement-spec` de Pocock).
- **Cómo está:** el Builder es la propia sesión de `/implement` (con `-p`, una sesión nueva por ticket); *Verify* son
  los comandos de «Comprobación automática», sin modelo, para que no dependa de lo que responda uno; *Review* es el
  subagente `reviewer`, con contexto aparte y solo lectura. `/run` es el orquestador y lanza un `claude -p` por
  ticket (recomendación del #17: da coste por ticket y no espera permisos).
- **Comprobado:** un subagente puede lanzar los suyos hasta tres niveles por debajo de la sesión principal
  (documentación de subagentes, 2026-10-27).
- **Datos:** del #14 al #16, 13-17 turnos y 0,49-0,86 USD por ticket. La única vuelta de más (#15) vino del orden de
  los pasos, no de mezclar fases.
- **Señal para hacerlo:** el Builder se queda sin contexto en tickets grandes, o hay vueltas porque el Builder se
  juzga a sí mismo. Antes, leer la investigación §3 y §7 sobre separar fases.

## Referencias a ficheros de este repositorio al pasar a plugin

- **Origen:** conversación del 2026-10-26. Las skills nombran ficheros que solo existen aquí:
  `documentation/launch-one-ticket.md` (`/implement`, solo como referencia), `CLAUDE.md` (comprobación automática) y
  `documentation/github-board.md` (ids y comandos del tablero).
- **Cuándo:** en la etapa 4, al sacar las skills a un plugin para otro proyecto.
- **Resuelto el 2026-10-27:** los datos del proyecto están en `.claude/factory.md` y las skills y el `reviewer` los
  leen de ahí (#30 y #31).

## `/to-request` toma texto libre como nombre del fichero

- **Origen:** uso del 2026-10-27. `/to-request` espera un nombre corto como argumento (`$0`). Se le pasó una lista
  de pendientes y `$0` quedó en «Sigue»: el fichero se habría llamado `spec-Sigue.md`. Se sacó el nombre de la
  idea a mano.
- **Cuándo:** la próxima vez que se toque `/to-request`.

## Notas de los tickets #15 y #16

- **Origen:** comentarios finales del #15 y del #16 (2026-10-26).
- `/to-tasks` sin argumento acepta el resumen de `/discover` como especificación: sin probar en uso real.
- `/to-request` escribe «Nada acordado» en una sección vacía y la plantilla `request.md` usa «Nada».
- El #16 añadió dos cosas que no pedía ninguna casilla (mandar ideas a `backlog.md` y el límite de ~70 caracteres
  por línea) y el revisor dio PASA: vigilar si el revisor deja pasar lo que se sale del ticket.
