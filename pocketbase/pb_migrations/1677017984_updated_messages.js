migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("bq78097ezgda5xu")

  collection.listRule = ""
  collection.viewRule = ""

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("bq78097ezgda5xu")

  collection.listRule = null
  collection.viewRule = null

  return dao.saveCollection(collection)
})
