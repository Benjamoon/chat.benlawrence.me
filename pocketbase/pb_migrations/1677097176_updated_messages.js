migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("bq78097ezgda5xu")

  collection.updateRule = "user.id = @request.auth.id"
  collection.deleteRule = "user.id = @request.auth.id"

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("bq78097ezgda5xu")

  collection.updateRule = null
  collection.deleteRule = null

  return dao.saveCollection(collection)
})
