## Problema
Después de construir del #14 al #18 quedan cosas por cerrar antes de seguir con la etapa 3:
- lanzar los tickets con `claude -p` funciona, pero el humano no ve en la consola lo que pasa mientras corre;
- el lanzamiento y algunas skills dependen de Windows, y Dynamo se va a usar también en Ubuntu o en un Mac;
- las skills y el `reviewer` llevan escritos datos de Dynamo (repositorio, tablero, etiquetas, rutas, reglas), y la
  factoría se quiere instalar después en otros proyectos, por ejemplo una web;
- `/implement` produce después de la revisión lo que una casilla pide fuera del código (un comentario en el
  ticket), y eso costó una vuelta de más en el #15;
- los nombres de los ficheros de `documentation/` son traducciones literales que no gustan al humano.

## Solución
- Sustituir `/run` por un workflow guardado en `.claude/workflows/`: un orquestador «tonto» que lee el estado en
  GitHub, lanza un agente por ticket en su propia copia, revisa con el `reviewer`, fusiona de uno en uno en la
  release y bloquea o salta lo que toque. Es el diseño probado en `documentation/ensayo-workflow.md`, con sus
  fallos 1-5 arreglados.
- Skills, agentes y workflow portables: funcionan en cualquier sistema operativo y no llevan datos de un proyecto;
  esos datos van en un fichero aparte de cada proyecto.
- Lanzar un ticket a mano con un comando portable y sin JSON.
- Que lo que una casilla pide fuera del código exista antes de la revisión.
- Nombres de fichero en inglés en `documentation/`, con el contenido en español.

## Qué cambia para quien lo usa
- El humano lanza una lista de tickets desde una sesión normal y la sigue en `/workflows`: fases, agentes, sus
  llamadas y sus tokens.
- Un ticket suelto se lanza con el mismo comando en cualquier sistema operativo.
- Para usar la factoría en otro proyecto basta con rellenar su fichero de datos (repositorio, tablero, rama,
  comprobación, idioma…); las skills no se tocan.
- Un ticket con una casilla «el comentario dice…» no necesita una segunda vuelta solo por el orden de los pasos.

## Decisiones
- Skills, agentes y comandos documentados funcionan en cualquier sistema operativo, sin referencias a PowerShell:
  Dynamo se va a usar también en Ubuntu o en un Mac (el humano, 2026-10-26).
- Se lanza un ticket por comando cuando se lanza a mano; no se documenta un bucle para lanzar varios (el humano,
  2026-10-26).
- El lanzamiento a mano deja de usar `--output-format json`, así que no hace falta `jq`. A mano no se anotan
  turnos ni coste, y eso se dice en el documento de lanzamiento y en `CLAUDE.md` (el humano, 2026-10-27).
- El orquestador de la etapa 3 es un workflow, no `claude -p`: el humano quiere verlo en la consola, y los tres
  ensayos de `documentation/ensayo-workflow.md` lo dieron por bueno (el humano, 2026-10-27).
- Los guiones de workflow son una excepción a «sin scripts propios» (ya en `CLAUDE.md`, 2026-10-27).
- Las copias de los subagentes salen del checkout actual: `worktree.baseRef: "head"` en `.claude/settings.json`
  (`d4a1a26`).
- Modelo por fase del workflow: Haiku con `effort: high` para leer el tablero, construir y fusionar; el `reviewer`
  en Opus, el que juzga (el humano, 2026-10-27).
- Coste: al acabar una lista se anota `/cost` de la sesión en el informe del PR; coste por lista, no por ticket.
  `CLAUDE.md` («se mide desde el primer ticket») se ajusta para decirlo (el humano, 2026-10-27).
- `.claude/skills/run/SKILL.md` se borra en el mismo ticket en que el workflow funcione con tickets reales: no dos
  piezas que hagan lo mismo (el humano, 2026-10-27).
- Si una casilla pide algo que el Builder escribe fuera del código (un comentario en el ticket, una nota), se
  produce durante la construcción, antes de la revisión, y el informe final no lo repite. Vale para `/implement` y
  para los agentes del workflow, y se redacta en general, no para Dynamo. En el workflow, el agente Build publica
  ese comentario durante su paso y el agente de fusión solo publica el informe final (el humano, 2026-10-27).
- Los datos de cada proyecto (repositorio, tablero y sus estados, etiquetas, rama de trabajo, comandos de
  comprobación, idioma, dónde van backlog y especificaciones) van en **un fichero aparte**, no en `CLAUDE.md`. Las
  skills, el `reviewer` y el workflow los leen de ahí y no nombran ninguno; el `reviewer` aplica las reglas del
  `CLAUDE.md` del proyecto, sin una lista fija. `CLAUDE.md` lo fija como convención. Se hace ahora, junto con lo de
  los sistemas operativos (el humano, 2026-10-27).
- En `/to-tasks`, la nota de Git Bash pasa a una frase neutra: «(if the shell rewrites a title that starts with
  `/`, see the note)»; el detalle de Windows se queda en la nota del tablero (el humano, 2026-10-27).
- El plan y el backlog dejan de nombrar Windows donde no hace falta: «programador de tareas del sistema (cron,
  launchd o el de Windows)» y «gestor de credenciales del sistema». El riesgo «Windows» de plan §7 se queda (el
  humano, 2026-10-27).
- Las rutas `E:\Proyectos\…` de `CLAUDE.md` y del plan se quedan: son de este PC y no las usa ninguna skill (el
  humano, 2026-10-27).
- Nombres de fichero de `documentation/` en inglés, contenido en español, y `CLAUDE.md` lo dice (el humano,
  2026-10-27):
  - `plan-factoria-de-agentes.md` → `agent-factory-plan.md`;
  - `investigacion-factorias-de-agentes.md` → `agent-factory-research.md`;
  - `tablero-github.md` → `github-board.md`;
  - `lanzar-implement.md` → `launch-one-ticket.md`;
  - `fontaneria-paralelo.md` → `parallel-launch-trial.md`;
  - `ensayo-workflow.md` → `workflow-trial.md`;
  - `peticion-*.md` → `spec-*.md`, también el prefijo que usa `/to-request`;
  - `backlog.md` no cambia.
- El fichero de datos del proyecto es `.claude/factory.md`, junto a las skills, para que viaje con el plugin cuando
  se saque (el humano, 2026-10-27).
- El idioma con el humano es una preferencia de la persona, no un dato del proyecto: va en su `~/.claude/CLAUDE.md`
  (el humano, 2026-10-27).
- El #17 y el #18 no se revisan aparte: valen con el PASA de su revisor (el humano, 2026-10-27).
- La tanda del #14 al #16 cuenta para «3 tickets seguidos sin intervenir» de la etapa 2, con el fallo de
  lanzamiento anotado (la skill no se lanzó como skill por la `/` en Git Bash). La etapa se cierra al aprobar el PR
  de `release/0.1.0` (el humano, 2026-10-27).

## Cómo se prueba
- Los tickets de esta especificación se construyen con el workflow nuevo, en cuanto exista: es su primera prueba
  con tickets reales.
- Cada ticket, además, con sus casillas comprobables con un comando o leyendo un fichero.

## Fuera de alcance
Nada acordado.

## Notas
- Hechos comprobados en el repositorio (2026-10-27):
  - Los ensayos y sus fallos están en `documentation/ensayo-workflow.md`. Sin probar: choque al fusionar,
    comprobación que falle tras fusionar, un permiso a mitad de ejecución, pausa por límite de uso y tickets
    reales.
  - Datos de Dynamo escritos en las piezas: `reviewer.md:8` («Dynamo agent factory») y `:42-43` (reglas fijas:
    «each skill at most ~150 lines», «working docs in Spanish»); `to-tasks/SKILL.md:77` (`--project "Dynamo"`);
    rutas `documentation/tablero-github.md`, `documentation/backlog.md` y `documentation/lanzar-implement.md` en
    `implement`, `to-tasks`, `run` y `discover`; etiquetas `hecho-en-release` y `bloqueado` en `implement` y
    `run`; «in Spanish» en todas.
  - Referencias a un sistema operativo:
    - `.claude/skills/to-tasks/SKILL.md:77-78` (Git Bash y `MSYS_NO_PATHCONV=1`);
    - `.claude/skills/run/SKILL.md:50,54` (`MSYS_NO_PATHCONV=1` y Git Bash);
    - `documentation/lanzar-implement.md:8-12` (PowerShell, `ConvertFrom-Json`, `E:\Proyectos\Dynamo`);
    - plan §6.3, §7 y §10.3 (`documentation/plan-factoria-de-agentes.md:208,274,282,374`);
    - `documentation/backlog.md` («Proteger `main`»: gestor de credenciales de Windows);
    - `documentation/tablero-github.md:46-47` (nota sobre Git Bash);
    - `documentation/fontaneria-paralelo.md` y `documentation/ensayo-workflow.md` dicen que se probaron en
      Windows: son registro de una prueba.
  - Pasar el prompt por la entrada estándar conserva la `/` (probado en Windows con Git Bash:
    `printf '/zz-no-existe hola' | claude -p` → «El comando `/zz-no-existe` no está instalado»). Sin probar en Linux
    ni en macOS.
  - El #15 hizo 2 vueltas porque el paso 6 de `/implement` publica el comentario que pedía una casilla después del
    veredicto. Historial: `Verify -> In Review -> In Progress -> Verify -> In Review`.
  - El plan (§6.4) preveía sacar las skills a un plugin en la etapa 4; la entrada «Referencias a ficheros de este
    repositorio al pasar a plugin» de `documentation/backlog.md` queda cubierta por esta especificación.
  - Un workflow da tokens por agente, no coste en USD.
  - `~/.claude/CLAUDE.md` está fuera del repositorio: una casilla sobre él no se puede comprobar con `git diff`.
