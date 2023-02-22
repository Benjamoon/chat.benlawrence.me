migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("bq78097ezgda5xu")

  collection.createRule = "user.id = @request.auth.id"

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("bq78097ezgda5xu")

  collection.createRule = null

  return dao.saveCollection(collection)
})
