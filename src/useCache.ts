import * as React from 'react';
import CacheContext from './CacheContext';

export default function useCache<T>(...keys: Array<keyof T>): T[] {
    const [state, setState] = React.useState([]);
    const cache = React.useContext(CacheContext);
    cache.batch(keys).then(items => setState(items));
    return state;
}
