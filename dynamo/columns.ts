// The columns of the board. The board template fixes their names, so they are Dynamo's, not a project's: the code names
// them here and `board.options` of factory.json holds only their option ids, keyed by these names.
export const COLUMNS = {
  backlog: 'Backlog', todo: 'Todo', build: 'Build', verify: 'Verify', review: 'Review', merge: 'Merge', needsHuman: 'Needs Human', done: 'Done',
} as const;
