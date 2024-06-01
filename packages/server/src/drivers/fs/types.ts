/**
 * Maps file path to node id. Represents the contents of the ids file used by
 * the {@link FsDriver} to store ids generated for files in the db.
 */
export type IdsFile = Record<string, string>;

/** A node in the Database represeting a Directory or JSON File. */
export interface Node {
  /** Directory or File id. Begins with `d` or `f` for Directory or File. */
  id: string;
  /** Children of this node. */
  children?: Set<Node>;

  /** The entry strictly contains the listing entry data shared with clients. */
  entry: {
    /** Parent (Directory) id. */
    pId?: string;
    /** Name of the Directory or File. */
    name: string;
    /** Change time Unix timestamp, e.g. milliseconds since UTC 1970-01-01. */
    ctime: number;
  };
  content?: unknown;
  // history?: NodeChange[];
  // futures?: NodeChange[];
}

export type MapNodeFn<T = Node> = (node: Node) => T;

export function MapNodeDefault(node: Node): Node {
  return node;
}

/**
 * A function called when visiting nodes, e.g. `eachNode`.
 * @returns `true` to stop tree traversal. `false` to stop at `index.depth`.
 */
export type VisitNodeFn<T = Node> = (
  node: T,
  index: { depth: number; order: number },
  siblings: T[],
  children: T[],
) => boolean | undefined | void;

export function isDirectoryNode(
  node: Node,
): node is Node & { children: Set<Node> } {
  return node.id.startsWith("d");
}

export function isFileNode(node: Node) {
  return node.id.startsWith("f");
}
