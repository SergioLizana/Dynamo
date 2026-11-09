// Jobs one at a time, in the order they were asked for, inside this process. The merge's checks run asynchronously, so two
// tickets of one `dynamo run` can reach `dynamo merge` together; the lock of git (merging.ts) would refuse the second, and
// the merges must wait for each other instead. A job that fails does not stop the ones queued behind it.
let tail: Promise<unknown> = Promise.resolve();

export function serially<T>(job: () => Promise<T>): Promise<T> {
  const result = tail.then(job, job);
  tail = result.catch(() => {});
  return result;
}
