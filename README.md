npm i react-remote-cache -S


App.tsx
```
import { Cache, CacheContext } from 'react-remote-cache';

const users = new Cache(u => u.id, id => loadRemoteUser(id), ids => batchLoadRemoveUser(ids));

export default function App() {
    return (
        <div>
            <CacheContext.Provider value={users}>
                <UserInfo userId={1} />
                <UserInfo userId={2} />
            </CacheContext.Provider>
        </div>
    )
}

```

UserInfo.tsx
```
import { useCache } from 'react-remote-cache';

export default function UserInfo(props) {
    const user = useCache(props.userId);
    return (
        <div>
            <p>{user.id}</p>
            <p>{user.name}</p>
        </div>
    );
}

```


> for caching mechanism, visit https://github.com/joesonw/bulkcache