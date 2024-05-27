import Path from "node:path";
import FS from "node:fs";
// Local
import {
  Config,
  Driver,
  ILogger,
  SchemaProvider,
  TransactionCallback,
} from "@/types";
import { FsDriver } from "@/drivers/fs";
import { TypeboxSchemaProvider } from "@/providers/typebox";

export interface DatabaseOptions extends Partial<Config> {
  /** Path to the config file. */
  config?: string;
}

/**
 * A JSON file system database engine.
 * @typeParam DB - The database file types interface. Keys of this type must
 * be names of JSON schemas that are registered with the database to validate
 * JSON file data.
 */
export class Database<DB> {
  /** Object name for the default `toString` implementation. */
  public readonly [Symbol.toStringTag]: string = "Database";
  /** The root file path of the database. */
  public readonly path: string;
  /** The database configuration. */
  public readonly config: Readonly<Config>;
  /** The database configuration file path. */
  public readonly configFile?: string;
  /** The common driver interface of the configured implementation. */
  public readonly driver: Driver;
  /** The common logger interface of the configured implementation. */
  public readonly logger: ILogger;
  /** Access to schemas. */
  public readonly schemas: SchemaProvider<DB>;

  /** `true` if {@link Database.open}, `false` if {@link Database.close}d */
  private _opened = false;
  private _transactionQueue: Array<TransactionRunner> = [];
  private _transactionsRunning = false;

  /**
   * Creates a new JSON file system database engine.
   * @param path The root file path to read from.
   */
  constructor(configPathOrOptions: string | DatabaseOptions) {
    // Normalize options.
    const options =
      typeof configPathOrOptions === "string"
        ? { config: configPathOrOptions }
        : configPathOrOptions;
    const { config: configPath, ...configDefaults } = options;
    // Resolve paths.
    const configFile = configPath ? Path.resolve(configPath) : undefined;
    const configDir = configFile ? Path.dirname(configFile) : undefined;
    // Get or create config.
    let config: Config = {
      root: configDefaults.root ?? "./data",
      ...configDefaults,
    };
    if (configFile) {
      if (!FS.existsSync(configFile)) {
        FS.writeFileSync(configFile, JSON.stringify(config));
      } else {
        const configJson = FS.readFileSync(configFile).toString();
        config = JSON.parse(configJson) as Config;
      }
    }
    // Get the main data path, ensure it exists.
    const path = Path.resolve(
      configDir ? Path.join(configDir, config.root) : config.root,
    );
    FS.mkdirSync(path, { recursive: true });

    Object.freeze(config);

    this[Symbol.toStringTag] = `Database("${configFile ?? path}")`;
    this.config = config;
    this.configFile = configFile;
    this.path = path;
    this.logger = console;
    this.schemas = new TypeboxSchemaProvider<DB>();
    this.driver = new FsDriver({
      db: this,
    });
  }
  // #region Lifecycle
  /** Closes the database if opened. */
  async close() {
    const { _opened } = this;
    if (!_opened) {
      return;
    }
    this._opened = false;
    await this.driver.close();
  }
  /**
   * Loads all directories and files within the database path.
   */
  async open() {
    const { _opened } = this;
    if (_opened) {
      throw new Error(`${this} is already opened.`);
    }
    await this.driver.open();
    this._opened = true;
  }
  // #endregion

  /** Prints the directory and file nodes with `console.log`. */
  async printDirectory() {
    const { logger } = this;
    return this.transaction((trx) => {
      let count = 0;
      let maxDepth = 0;
      let maxItemsOneParent = 0;
      logger.log(
        "\n" + `[${new Date().toISOString()}] Nodes in ${this}` + "\n",
      );
      console.time("Time to print directory");
      trx.eachNode(null, (node, { depth, order }, siblings, children) => {
        count += 1;
        maxDepth = Math.max(maxDepth, depth);
        maxItemsOneParent = Math.max(maxItemsOneParent, order + 1);
        const indent = ": ".repeat(depth) + "|";
        logger.log(
          (indent + "- " + node.name + (node.isDir ? "/" : "")).padEnd(40) +
            node.path.padEnd(60) +
            `depth:${depth} ord:${order} childs:${children.length} sibs:${siblings.length - 1}  id:${node.id}`,
        );
      });
      logger.log("");
      logger.log("            Total nodes:", count);
      logger.log("              Max depth:", maxDepth);
      logger.log("Max nodes single parent:", maxItemsOneParent);
      console.timeEnd("Time to print directory");
      logger.log("");
    });
  }

  // #region Transactions

  async transaction<T>(cb: TransactionCallback<T>): Promise<T> {
    const runner = new TransactionRunner<T>(this.driver, cb);
    this._transactionQueue.push(runner);
    this.processTransactionQueue();
    return runner.completed;
  }

  private async processTransactionQueue() {
    if (this._transactionsRunning) {
      return;
    }
    this._transactionsRunning = true;
    const { _transactionQueue: queue } = this;
    while (queue.length > 0 && this._opened) {
      const runner = queue.shift();
      if (runner) {
        const result = await runner.run();
        if (result.err) {
          // TODO: Better error handling...
          console.error("Transaction", result.err);
          break;
        }
      }
    }
    this._transactionsRunning = false;
  }
  // #endregion
}

class TransactionRunner<T = any> {
  callback: TransactionCallback<T>;
  completed: Promise<T>;
  driver: Driver;
  reject: (reason?: T) => void;
  resolve: (value: T | PromiseLike<T>) => void;

  constructor(driver: Driver, callback: TransactionCallback<T>) {
    this.driver = driver;
    this.callback = callback;
    let onRejected: TransactionRunner["reject"];
    let onResolved: TransactionRunner["resolve"];
    this.completed = new Promise<T>((resolve, reject) => {
      onRejected = reject;
      onResolved = resolve;
    });
    this.reject = onRejected!;
    this.resolve = onResolved!;
  }

  async run() {
    const { callback, driver, reject, resolve } = this;
    let err: any | undefined;
    let value: T | undefined;

    let maybePromise: any = undefined;
    try {
      const transaction = driver.createTransaction();
      maybePromise = callback(transaction);
    } catch (ex) {
      err = ex;
    }
    if (maybePromise && typeof maybePromise.then === "function") {
      await maybePromise
        .then((val?: any) => {
          value = val;
          // console.log("TRX-RESOLVED", val);
          resolve(val);
        })
        .catch((reason?: any) => {
          err = reason;
          // console.log("TRX-REJECTED", reason);
          reject(reason);
        });
    } else if (err) {
      // console.log("TRX-REJECT", err);
      reject(err);
    } else {
      value = maybePromise;
      // console.log("TRX-RESOLVE", value);
      resolve(value!);
    }
    return {
      err,
      value,
    };
  }
}
