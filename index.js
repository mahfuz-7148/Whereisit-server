require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
// const cookieParser = require("cookie-parser");
const jwt = require('jsonwebtoken');


// Firebase Admin SDK
const admin = require("firebase-admin");
const serviceAccount = require("./path-to-your-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const port = process.env.PORT || 3000;

// // Handle OPTIONS requests
// app.options('*', cors({
//   origin: "https://whereisit-61ba5.web.app",
//   credentials: true,
//   methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
//   allowedHeaders: ["Content-Type", "Authorization"]
// }));

// Update your CORS middleware configuration
// app.use(
//   cors({
//     origin: "https://whereisit-61ba5.web.app",
//     credentials: true,
//     methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
//     allowedHeaders: ["Content-Type", "Authorization"]
//   })
// );

// Middleware
app.use(
  cors()
);
app.use(express.json());
// app.use(cookieParser());

// JWT creation route
app.post('/jwt', async (req, res) => {
  const user = req.body;
  console.log("User received for JWT:", user);
  console.log("JWT Secret:", process.env.JWT_SECRET ? "FOUND" : "NOT FOUND");

  if (!user || !user.email) {
    return res.status(400).send({ error: "User email is required to generate token" });
  }

  try {
    const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.send({ token });
  } catch (error) {
    console.error("JWT generation error:", error);
    res.status(500).send({ error: "Failed to generate token" });
  }
});

// Firebase verifyToken middleware
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ error: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; 
    next();
  } catch (error) {
    return res.status(401).send({ error: "Unauthorized: Invalid token" });
  }
};

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8ek00d7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    // console.log("Connected to MongoDB successfully!");

    const db = client.db("whereIsItDB");
    const itemsCollection = db.collection("items");
    const recoveredItemsCollection = db.collection("recoveredItems");

    
    

    // Protected routes with verifyToken middleware

    app.get("/allItems", verifyToken, async (req, res) => {
      try {
        const allItems = await itemsCollection.find().toArray();
        res.send(allItems);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch items", error: err });
      }
    });

    app.get("/recoveredItems", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (!email)
        return res.status(400).send({ message: "Email query required" });

      try {
        const items = await recoveredItemsCollection
          .find({ "recoveredBy.email": email })
          .toArray();
        res.send(items);
      } catch (err) {
        res
          .status(500)
          .send({ message: "Failed to fetch recovered items", error: err });
      }
    });

    app.post("/recoveredItems", verifyToken, async (req, res) => {
      const recoveredItem = req.body;
      try {
        const existingRecovered = await recoveredItemsCollection.findOne({
          originalItemId: new ObjectId(recoveredItem.originalItemId),
        });
        if (existingRecovered)
          return res.status(400).send({ message: "Item already recovered" });

        const result = await recoveredItemsCollection.insertOne(recoveredItem);
        res.status(201).send({ insertedId: result.insertedId });
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to add recovered item", error });
      }
    });

    app.patch("/items/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      if (!ObjectId.isValid(id))
        return res.status(400).send({ error: "Invalid ID format" });

      try {
        const result = await itemsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        if (result.matchedCount === 0)
          return res.status(404).send({ error: "Item not found" });
        res.send({ modifiedCount: result.modifiedCount });
      } catch (error) {
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    // Public routes
    app.get("/items", async (req, res) => {
      try {
        const sortParam = req.query.sort;
        const limit = parseInt(req.query.limit) || 0;
        let sortOption = {};
        if (sortParam === "date_desc") sortOption = { date: -1 };

        const items = await itemsCollection
          .find()
          .sort(sortOption)
          .limit(limit)
          .toArray();
        res.send(items);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch items", error });
      }
    });

    app.get("/items/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id))
        return res.status(400).send({ error: "Invalid ID format" });

      const item = await itemsCollection.findOne({ _id: new ObjectId(id) });
      if (!item) return res.status(404).send({ message: "Item not found" });
      res.send(item);
    });

    app.post("/addItems", verifyToken, async (req, res) => {
      const item = req.body;
      try {
        const result = await itemsCollection.insertOne(item);
        res.status(201).send({
          message: "Item added successfully",
          insertedId: result.insertedId,
        });
      } catch (err) {
        res.status(500).send({ message: "Failed to add item", error: err });
      }
    });

    app.put("/updateItems/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const updatedItem = req.body;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ error: "Invalid ID format" });

      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: updatedItem };

      try {
        const result = await itemsCollection.updateOne(filter, updateDoc);
        res.send({ modifiedCount: result.modifiedCount });
      } catch (error) {
        res.status(500).json({ error: "Failed to update item." });
      }
    });

    app.delete("/items/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id))
        return res.status(400).send({ error: "Invalid ID format" });

      try {
        const result = await itemsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 0)
          return res.status(404).send({ error: "Item not found" });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Internal Server Error" });
      }
    });
  } catch (err) {
    console.error("Failed to connect:", err);
  }
}

run();

app.get("/", (req, res) => {
  res.send("WhereIsIt app is cooking!");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
