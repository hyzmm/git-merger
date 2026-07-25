import pick from "lodash-es/pick";

export function createPicker<T>() {
  return <K extends keyof T>(...keys: readonly K[]) =>
    (state: T): Pick<T, K> =>
      pick(state, keys) as Pick<T, K>;
}
