migrate((db) => {
  const collection = new Collection({
    "id": "bq78097ezgda5xu",
    "created": "2023-02-21 22:19:13.626Z",
    "updated": "2023-02-21 22:19:13.626Z",
    "name": "messages",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "hnvsrucj",
        "name": "user",
        "type": "relation",
        "required": true,
        "unique": false,
        "options": {
          "collectionId": "_pb_users_auth_",
          "cascadeDelete": true,
          "maxSelect": 1,
          "displayFields": [
            "username"
          ]
        }
      },
      {
        "system": false,
        "id": "1kmyurrw",
        "name": "content",
        "type": "text",
        "required": true,
        "unique": false,
        "options": {
          "min": null,
          "max": 255,
          "pattern": ""
        }
      }
    ],
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null,
    "options": {}
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("bq78097ezgda5xu");

  return dao.deleteCollection(collection);
})
