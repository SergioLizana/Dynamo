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
- **Opciones:** `worktree.baseRef: "head"` (sin probar); o no usarlas y crear las copias con `git worktree add`, que
  es lo que recomienda `documentation/fontaneria-paralelo.md`. El desfase se cierra solo cuando la release llegue a
  `main`.
- **Cuándo:** solo si `/run` acaba usando subagentes aislados o `--bg`.

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

- **Origen:** revisión del #17. La tabla de `documentation/fontaneria-paralelo.md` dice que la copia de un subagente
  se borra sola «si no cambia nada, ni de rama». Viene de la documentación (investigación §3.2): en las pruebas
  ninguna copia se borró sola, porque las dos tenían cambios o habían cambiado de rama.
- **Cuándo:** si `/run` llega a depender de esa limpieza.
