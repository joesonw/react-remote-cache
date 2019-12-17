import * as React from 'react';
import Cache from './Cache';

const CacheContext = React.createContext<Cache<any>>(null);
export default CacheContext;
