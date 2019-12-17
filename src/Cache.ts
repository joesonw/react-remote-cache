import * as Q from 'q';
import * as _ from 'lodash';
import WaitGroup from './WaitGroup';

export default class Cache<V, K = keyof V> {
    private storage = new Map<K, V>();
    private queue = new Map<K, Q.Deferred<V>>();
    private errorHandler: (e: Error) => void = () => {};
    private fetchAllDefer: Q.Deferred<V[]>;
    private allFetched = false;

    constructor(
        private idGetter: (item: V) => K,
        private fetch: (id: K) => PromiseLike<V>,
        private bulkFetch?: (ids: K[]) => PromiseLike<V[]>,
        private fetchAll?: () => PromiseLike<V[]>,
    ) {
    }

    flush() {
        const err = new Error('All data/pending requests flushed');
        Array.from(this.queue.values()).forEach(d => d.reject(err));
        this.queue.clear();
        this.storage.clear();
        this.allFetched = false;
    }

    add(item: V) {
        this.resolve(this.idGetter(item), item);
    }

    async all(): Promise<V[]> {
        if (!this.allFetched && this.fetchAll && !this.fetchAllDefer) {
            this.fetchAllDefer = Q.defer<V[]>();
            try {
                const values = await this.fetchAll()
                values.forEach(v => this.resolve(this.idGetter(v), v));
                this.allFetched = true;
                this.fetchAllDefer.resolve(values);
            } catch (e) {
                const d = this.fetchAllDefer;
                this.fetchAllDefer = null;
                d.reject(e);
            }
        }
        const result: V[] = Array.from(this.storage.values());
        const promises = Promise.all(Array.from(this.queue.values()).map(d => d.promise));
        result.push(...(await promises));
        if (!this.allFetched && this.fetchAll) {
            result.push(...await this.fetchAllDefer.promise);
        }
        return Promise.resolve<V[]>(_.uniqBy(result, v => this.idGetter(v)));
    }

    get(id: K): PromiseLike<V> {
        // is fetching all, so no need to fetch single
        if (this.fetchAllDefer) {
            return this.fetchAllDefer.promise
                .then(() => Promise.resolve(this.storage.get(id)));
        }

        // already cached, retrieve result directly
        if (this.storage.has(id)) {
            return Promise.resolve(this.storage.get(id));
        }

        /*
            not in cache yet
            but somebody else has requested it, and the request is in-flight
            we shall just wait for the result to be retruend
        */
        if (this.queue.has(id)) {
            return this.queue.get(id).promise;
        }

        const d = Q.defer<V>();
        this.queue.set(id, d);

        (async () => {
            try {
                const item = await this.fetch(id);
                this.resolve(id, item);
            } catch (e) {
                this.errorHandler(e);
                this.resolve(id, null);
            }
        })();

        return d.promise;
    }

    batch(ids: K[]): PromiseLike<V[]> {
        const result: V[] = [];
        const waitForPendingResources = new WaitGroup(ids.length);

        const neverFetchedIDs = ids.slice().filter((id) => {
            // already cached, retrieve result directly
            if (this.storage.has(id)) {
                result.push(this.storage.get(id));
                waitForPendingResources.done();
                return false;
            }

            /*
                not in cache yet
                but somebody else has requested it, and the request is in-flight
                we shall just wait for the result to be retruend
            */
            if (this.queue.has(id)) {
                this.queue.get(id)
                    .promise.then((res) => {
                        result.push(res);
                        waitForPendingResources.done();
                    });
                return false;
            }

            /*
                not cached
                no one requested it yet
                placehold the defer first, in case later in this iteration, a repeated key appears.
            */
            const d = Q.defer<V>();
            this.queue.set(id, d);
            d.promise.then((res) => {
                result.push(res);
                waitForPendingResources.done();
            });
            return true;
        });

        (async () => {
            try {
                if (neverFetchedIDs.length) {
                    let list: V[] = [];
                    if (this.bulkFetch) {
                        list = await this.bulkFetch(_.uniq(neverFetchedIDs.slice()));
                    } else {
                        list = await Promise.all(_.uniq(neverFetchedIDs.slice()).map((id) => this.fetch(id)));
                    }
                    const ids = _.uniq(neverFetchedIDs.slice());
                    if (list && list.length) {
                        for (const item of list) {
                            if (!item) continue;
                            const id = this.idGetter(item);
                            const index = ids.indexOf(id);
                            ids.splice(index, 1);
                            this.resolve(id, item);
                        }
                    }
                    for (const id of ids) {
                        this.resolve(id, null);
                    }
                    waitForPendingResources.finish();
                }
            } catch (e) {
                this.errorHandler(e);
            }
        })();

        return waitForPendingResources.wait().then(() => Promise.resolve(result));
    }

    private resolve(id: K, item: V) {
        if (item) {
            this.storage.set(id, item);
        }
        const d = this.queue.get(id);
        if (d) {
            d.resolve(item);
        }
        this.queue.delete(id);
    }

    setErrorHandler(handler: (e: Error) => void) {
        this.errorHandler = handler;
    }
}