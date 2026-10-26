# Fontanería local para dos `/implement` a la vez

Probado el 2026-10-26 con Claude Code 2.1.310 en Windows 11 (Git Bash), desde `ticket/17-fontaneria-paralelo`
(que sale de `release/0.1.0`, `7297184`), para el ticket #17. Opciones de plan §6.3; la decisión es para `/run`
(etapa 3a). Las sondas usaron Haiku y tareas mínimas: los costes valen para comparar, no para presupuestar.

Dato de partida que lo cambia todo: `main` está en `cc2dc46`, 30 commits por detrás de `release/0.1.0`, y **no tiene
`.claude/`** (ni `settings.json`, ni skills, ni el `reviewer`).

## 1. Subagente con `isolation: worktree`

Comando: la herramienta `Agent` con `isolation: "worktree"` (la misma opción que `isolation: worktree` en la cabecera
de `.claude/agents/<nombre>.md`; no se creó un agente nuevo porque exige reiniciar la sesión). Dos a la vez, en segundo
plano, desde la sesión principal en modo `auto`: uno sin cambios y otro que crea un fichero.

Lo que salió:

- Copias en `.claude/worktrees/agent-<id>/`, rama `worktree-agent-<id>`, ambas en `cc2dc46`: **salen de `main`**.
- El de sin cambios hizo `git checkout release/0.1.0` y **git le dejó** (la carpeta principal estaba en la rama del
  ticket). Desde ese momento, ni otra copia ni la carpeta principal podían sacarla:
  `fatal: 'release/0.1.0' is already used by worktree at 'E:/Proyectos/Dynamo/.claude/worktrees/agent-abc7798c4809b0bdb'`
  (salida 128).
- Esa copia **no se borró sola** al terminar: había cambiado de rama, aunque no tocó ningún fichero.
- La copia no tiene `.claude/` (`ls: cannot access '.claude'`), pero el subagente aplica los permisos de la sesión
  principal: su `git branch -D` (lista «ask») **subió como aviso a la sesión principal**, que `claude agents --json`
  marcaba `"waitingFor": "permission prompt"`. El subagente esperó hasta que se contestó: 581 s, frente a 15 s el
  que no lo pedía. Él no lo notó: informó «no permission prompt appeared».
- La copia del que creó `probe-subagent-a.txt` **se queda** en disco al terminar, como dice la investigación §3.2.
- Coste: el aviso de fin da tokens (`subagent_tokens` 34406 y 35954), duración y nº de herramientas; **no da
  `total_cost_usd`**. Va dentro del coste de la sesión principal.

## 2. `claude --bg`

Comando, desde `E:\Proyectos\Dynamo`:

```bash
claude --bg "<sonda: pwd, crear probe-bg.txt, ls .claude/settings.json, git branch -D <rama inexistente>>" --model haiku
claude agents --json        # estado
claude logs e1302cf7        # salida
claude stop e1302cf7
```

Lo que salió:

- Antes de escribir, la sesión entró sola en una copia: `.claude/worktrees/probe-bg`, rama `worktree-probe-bg`, en
  `cc2dc46`: **sale de `main`**, y la copia no tiene `.claude/settings.json`.
- Aun así aplicó los permisos del proyecto, porque los leyó al arrancar en la carpeta principal: «Ask rule
  `Bash(git branch -D*)` overrides auto mode for this command».
- **Se quedó esperando**: `"status": "waiting", "waitingFor": "permission prompt", "state": "blocked"` hasta que la
  paré. Nadie más se entera salvo que mire `claude agents`.
- Coste: ni `claude agents --json` ni `claude logs` dan `total_cost_usd`.
- `claude stop` dice `worktree retained at ...\probe-bg` y `run 'claude rm e1302cf7' to remove worktree and job
  state`: **no se borra sola**; la quita `claude rm` (si es seguro).
- No se probó su commit, push y PR en borrador del final: la sonda lo prohibía y aquí no se hace push sin
  autorización.

## 3. `git worktree add` + `claude -p`

Comandos (dos a la vez, en segundo plano):

```bash
git worktree add -b exp/17-a ../Dynamo-wt/t17-a release/0.1.0
git worktree add -b exp/17-b ../Dynamo-wt/t17-b release/0.1.0
cd ../Dynamo-wt/t17-a && claude -p "<sonda>" --output-format json --model haiku --max-budget-usd 0.5 --permission-prompts none
```

Lo que salió:

- Cada copia en su rama y en `7297184`: **sale de donde dices**, aquí `release/0.1.0`, con su `.claude/`.
- Aplicó `.claude/settings.json`: escribir un fichero pasó por `Edit(/**)`; `git branch -D` (lista «ask») se
  denegó al instante: «It requires approval, and this session has no approval surface … so it was denied
  automatically». Sale en `permission_denials` del JSON. `git worktree list`, fuera de la lista, corrió (Claude Code
  trata los comandos git de solo lectura como seguros).
- **No se queda esperando**: con `--permission-prompts none` lo que preguntaría se deniega.
- Coste: **sí**, `total_cost_usd` 0.0055 y 0.0056, `num_turns` 7, `subtype: success`.
- La copia **no se borra sola**: hay que hacer `git worktree remove` (como dice la investigación §3.3).

## Resumen

| | Subagente `isolation: worktree` | `claude --bg` | `git worktree add` + `claude -p` |
|---|---|---|---|
| Rama de la copia | `main` (`fresh`) | `main` (`fresh`) | la que se le pase (`release/x.y.z`) |
| `.claude/settings.json` | el de la sesión principal | sí, el de la carpeta de lanzamiento; la copia no lo tiene | sí, el de la copia |
| Espera un permiso | sí, en la sesión principal | sí, «Needs input» hasta que alguien conteste | no: se deniega |
| `total_cost_usd` | no (solo tokens) | no | sí |
| Se borra sola | solo si no cambia nada, ni de rama | no (`claude rm`) | no (`git worktree remove`) |

`worktree.baseRef: "head"` haría salir las dos primeras de la rama actual (investigación §3.3); no se probó aquí. Aun
con eso, seguirían sin dar el coste por ticket y esperando permisos.

## Cómo fusionan dos copias en la misma `release/x.y.z`

`/implement` hace `git checkout <base>` para fusionar (paso 5). Git no deja sacar una rama en dos copias de trabajo a
la vez, y basta con que una la tenga para que las demás, **incluida la carpeta principal**, fallen con salida 128
(probado arriba). Con dos `/implement` tal cual, el segundo en llegar al paso 5 se bloquearía.

Cómo se resuelve sin inventar nada:

- Las copias **nunca** sacan la base. Las ramas viven en el mismo repositorio, así que cada copia ve la base sin
  `fetch`: antes de terminar, `git merge <base>` en su rama del ticket y vuelve a pasar la comprobación (plan §7).
- Solo un sitio tiene la base sacada y fusiona: la carpeta principal, donde corre `/run`. Fusiona **de una en una**
  (`git merge --no-ff ticket/<n>-<slug>`) y pasa la comprobación tras cada fusión.
- Si choca, `git merge --abort` y el ticket queda bloqueado. Probado en `exp/17-base`: `exp/17-a` entró
  (salida 0); `exp/17-b` dio `CONFLICT (add/add): Merge conflict in probe-p.txt` (salida 1) y `git merge --abort`
  dejó la base limpia.

Para eso, `/implement` dentro de una copia tiene que acabar en el commit de su rama y no fusionar. Cambiarlo es
trabajo de `/run` (#18), no de este ticket.

## `implement-spec` de Pocock

Leído en `raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/implement-spec/SKILL.md` el 2026-10-26.

Qué resuelve:

- El mismo reparto que arriba: cada implementador en su copia y su rama; **antes de terminar fusiona la punta de
  la rama de integración en la suya**; un *merger subagent* aparte mete cada resultado en la integración.
- Que la copia salga de `main`: el implementador «confirms its worktree is based on the integration branch before
  starting, and resets onto it if not».
- La frontera: lanza implementadores nuevos cuando una fusión la cambia. Limpia las copias al final.

Qué no resuelve:

- Choques al fusionar ni tickets que fallan: no dice qué hacer (ya lo anotaba plan §4).
- Comprobación tras cada fusión: solo hay un `code-review` al final.
- Coste por ticket: usa subagentes, que no dan `total_cost_usd`.
- Permisos desatendidos: los subagentes en segundo plano esperan en la sesión principal.
- Que el *merger* no saque la base en una copia: no dice dónde corre.

## Recomendación para `/run`

**`git worktree add <copia> <base>` + `claude -p`**, una por ticket, y la fusión en serie en la carpeta principal.

- Es la única que sale de `release/x.y.z` sin configurar nada y trae el `.claude/` de esa rama.
- Es la única que no se queda esperando (`--permission-prompts none`) y da `total_cost_usd` por ticket, que ya usa
  `documentation/lanzar-implement.md`.
- Lo que cuesta: `/run` crea y borra las copias (`git worktree add` / `git worktree remove`) y espera a dos procesos.
  Son dos comandos de git, no un script propio.
- Las otras dos: los subagentes salen de `main`, no dan coste y esperan en la sesión principal; `--bg` sale de
  `main`, se queda en «Needs input» y su final pide push y PR, que aquí no se hacen sin autorización.
