// What `dynamo setup` does to the `project` block of a factory.json that already exists, so that running it again after
// `claude plugin update` brings the file up to date with the template: a key the template has and the file lacks is added with
// the template's value, a key with no value in the template (`<…>`) is named to be asked, and a key the template no longer has
// is removed. Pure: data in, data out. The template is the one place of the values; the values the file has are never changed.
type Block = Record<string, unknown>;

export type Update = { project: Block; added: string[]; removed: string[]; asked: string[] };

// A template value the person must give: the `<…>` of the template, alone or in a list.
function isPlaceholder(value: unknown): boolean {
  return value === '<…>' || (Array.isArray(value) && value.some(isPlaceholder));
}

function isBlock(value: unknown): value is Block {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// `template` and `had` are the `project` blocks. `values` are the keys the setup reads itself (repo, boardOwner, mainBranch): a
// missing one is asked like a placeholder even if the template has a value, since the value comes from gh and git.
// Names are dotted (`levels.low.builder`). Neither block is changed.
export function updateOf(template: Block, had: Block, values: string[], path = ''): Update {
  const project: Block = { ...had };
  const added: string[] = [];
  const removed: string[] = [];
  const asked: string[] = [];
  for (const [key, wanted] of Object.entries(template)) {
    const name = `${path}${key}`;
    if (!Object.hasOwn(had, key)) {
      if (isPlaceholder(wanted) || (path === '' && values.includes(key))) asked.push(name);
      else { project[key] = wanted; added.push(name); }
    } else if (isBlock(wanted) && isBlock(had[key])) {
      const inner = updateOf(wanted, had[key], values, `${name}.`);
      project[key] = inner.project;
      added.push(...inner.added);
      removed.push(...inner.removed);
      asked.push(...inner.asked);
    }
  }
  for (const key of Object.keys(had)) {
    if (!Object.hasOwn(template, key)) { delete project[key]; removed.push(`${path}${key}`); }
  }
  return { project, added, removed, asked };
}
