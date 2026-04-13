const DB = {
  name: 'ObraApp',
  version: 4,   // bump to force upgrade and add all stores
  db: null,

  async open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const stores = {
          projects:  [['name','name']],
          events:    [['date','date'],['projectId','projectId'],['type','type']],
          media:     [['eventId','eventId']],
          audios:    [['eventId','eventId']],
          files:     [['eventId','eventId']],
          notes:     [['eventId','eventId']],
          contacts:  [['role','role'],['project','project']],
        };
        for (const [storeName, indexes] of Object.entries(stores)) {
          let store;
          if (!db.objectStoreNames.contains(storeName)) {
            store = db.createObjectStore(storeName, { keyPath: 'id' });
          } else {
            store = e.target.transaction.objectStore(storeName);
          }
          for (const [idxName, path] of indexes) {
            if (!store.indexNames.contains(idxName)) {
              store.createIndex(idxName, path);
            }
          }
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },

  tx(store, mode = 'readonly') {
    return this.db.transaction(store, mode).objectStore(store);
  },

  async getAll(store, index, value) {
    return new Promise((resolve, reject) => {
      try {
        let req;
        if (index && value !== undefined) {
          req = this.tx(store).index(index).getAll(value);
        } else {
          req = this.tx(store).getAll();
        }
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } catch(e) {
        resolve([]); // store might not exist yet
      }
    });
  },

  async get(store, id) {
    return new Promise((resolve, reject) => {
      try {
        const req = this.tx(store).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch(e) { resolve(null); }
    });
  },

  async put(store, data) {
    return new Promise((resolve, reject) => {
      if (!data.id) data.id = crypto.randomUUID();
      if (!data.createdAt) data.createdAt = new Date().toISOString();
      data.updatedAt = new Date().toISOString();
      try {
        const req = this.tx(store, 'readwrite').put(data);
        req.onsuccess = () => resolve(data);
        req.onerror = () => reject(req.error);
      } catch(e) { reject(e); }
    });
  },

  async delete(store, id) {
    return new Promise((resolve, reject) => {
      try {
        const req = this.tx(store, 'readwrite').delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch(e) { reject(e); }
    });
  }
};
