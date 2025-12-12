
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Decode Firebase service account key
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf-8");
const serviceAccount = JSON.parse(decoded);

// Initialize Firebase admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middleware
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5174"], // frontend URLs
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// JWT middleware
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Connect to MongoDB
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("booksDB");
    const booksCollection = db.collection("books");

    // Ping MongoDB
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB successfully!");

    // POST /books -> add a book
    app.post("/books", async (req, res) => {
      const bookData = req.body;
      const result = await booksCollection.insertOne(bookData);
      res.send(result);
    });

    // GET /books -> get all books
    app.get("/books", async (req, res) => {
      const result = await booksCollection.find().toArray();
      res.send(result);
    });

    // GET /books/:id -> get book by ID
    app.get("/books/:id", async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ID" });
      }

      const result = await booksCollection.findOne({ _id: new ObjectId(id) });
      if (!result) {
        return res.status(404).send({ error: "Book not found" });
      }

      res.send(result);
    });
  } catch (err) {
    console.error(err);
  }
}

run().catch(console.dir);

// Test route
app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
