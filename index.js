require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const admin = require('firebase-admin')
const port = process.env.PORT || 5000
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
  'utf-8'
)
const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const app = express()
// middleware
app.use(
  cors({
    origin: [process.env.CLIENT_DOMAIN],
    credentials: true,
    optionSuccessStatus: 200,
  })
)
app.use(express.json())

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1]
  console.log(token)
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.tokenEmail = decoded.email
    console.log(decoded)
    next()
  } catch (err) {
    console.log(err)
    return res.status(401).send({ message: 'Unauthorized Access!', err })
  }
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {
    const db = client.db("booksDB");
    const booksCollection = db.collection("books");
    const ordersCollection = db.collection('orders')
    const usersCollection = db.collection('users')

    // Save a book data in db
    app.post('/books', async (req, res) => {
      const bookData = req.body
      console.log(bookData)
      const result = await booksCollection.insertOne(bookData)
      res.send(result)
    })

    // get all books from db
    app.get('/books', async (req, res) => {
      const result = await booksCollection.find().toArray()
      res.send(result)
    })

    // get all books from db
    app.get('/books/:id', async (req, res) => {
      const id = req.params.id
      const result = await booksCollection.findOne({ _id: new ObjectId(id) })
      res.send(result)
    })

    // Payment endpoints
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body
      console.log(paymentInfo)
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: paymentInfo?.name,
                description: paymentInfo?.description,
                images: [paymentInfo.image],
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        customer_email: paymentInfo?.customer?.email,
        mode: 'payment',
        metadata: {
          bookId: paymentInfo?.bookId,
          customer: paymentInfo?.customer.email,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/book/${paymentInfo?.bookId}`,
      })
      res.send({ url: session.url })
    })

    app.post('/payment-success', async (req, res) => {
      const { sessionId } = req.body
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      const book = await booksCollection.findOne({
        _id: new ObjectId(session.metadata.bookId),
      })
      const order = await ordersCollection.findOne({
        transactionId: session.payment_intent,
      })

      if (session.status === 'complete' && book && !order) {
        // save order data in db
        const orderInfo = {
          bookId: session.metadata.bookId,
          transactionId: session.payment_intent,
          customer: session.metadata.customer,
          status: 'pending',
          seller: book.seller,
          name: book.name,
          category: book.category,
          quantity: 1,
          price: session.amount_total / 100,
          image: book?.image,
        }
        const result = await ordersCollection.insertOne(orderInfo)
        // update book quantity
        await booksCollection.updateOne(
          {
            _id: new ObjectId(session.metadata.bookId),
          },
          { $inc: { quantity: -1 } }
        )

        return res.send({
          transactionId: session.payment_intent,
          orderId: result.insertedId,
        })
      }
      res.send(
        res.send({
          transactionId: session.payment_intent,
          orderId: order._id,
        })
      )
    })

    // get all orders for a customer by email
    app.get('/my-orders/:email', async (req, res) => {
      const email = req.params.email

      const result = await ordersCollection.find({ customer: email }).toArray()
      res.send(result)
    })

    // get all orders for a seller by email
    app.get('/manage-orders/:email', async (req, res) => {
      const email = req.params.email

      const result = await ordersCollection
        .find({ 'seller.email': email })
        .toArray()
      res.send(result)
    })

    // get all books for a seller by email
    app.get('/my-inventory/:email', async (req, res) => {
      const email = req.params.email

      const result = await booksCollection
        .find({ 'seller.email': email })
        .toArray()
      res.send(result)
    })

// save or update a user in db
    app.post('/user', async (req, res) => {
      const userData = req.body
      userData.created_at = new Date().toISOString()
      userData.last_loggedIn = new Date().toISOString()
      userData.role = 'customer'

      const query = {
        email: userData.email,
      }

      const alreadyExists = await usersCollection.findOne(query)
      console.log('User Already Exists---> ', !!alreadyExists)

      if (alreadyExists) {
        console.log('Updating user info......')
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        })
        return res.send(result)
      }

      console.log('Saving new user info......')
      const result = await usersCollection.insertOne(userData)
      res.send(result)
    })



    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from Server..')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})




// require("dotenv").config();
// const express = require("express");

// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
// const cors = require("cors");
// const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
// const admin = require("firebase-admin");


// const app = express();
// const port = process.env.PORT || 5000;

// // Decode Firebase service account key
// const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf-8");
// const serviceAccount = JSON.parse(decoded);

// // Initialize Firebase admin
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

// // Middleware
// app.use(
//   cors({
//     origin: ["http://localhost:5173",
//       "http://localhost:5174",
//       process.env.CLIENT_DOMAIN], 
//     credentials: true,
//     optionSuccessStatus: 200,
//   })
// );
// app.use(express.json());

// // JWT middleware
// const verifyJWT = async (req, res, next) => {
//   const token = req?.headers?.authorization?.split(" ")[1];
//   if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
//   try {
//     const decoded = await admin.auth().verifyIdToken(token);
//     req.tokenEmail = decoded.email;
//     next();
//   } catch (err) {
//     return res.status(401).send({ message: "Unauthorized Access!", err });
//   }
// };

// // Connect to MongoDB
// const client = new MongoClient(process.env.MONGODB_URI, {
//   serverApi: {
//     version: ServerApiVersion.v1,
//     strict: true,
//     deprecationErrors: true,
//   },
// });

// async function run() {
//   try {
//     const db = client.db("booksDB");
//     const booksCollection = db.collection("books");

//     // Ping MongoDB
//     await client.db("admin").command({ ping: 1 });
//     console.log("Connected to MongoDB successfully!");

//     // POST /books -> add a book
//     app.post("/books", async (req, res) => {
//       const bookData = req.body;
//       const result = await booksCollection.insertOne(bookData);
//       res.send(result);
//     });

//     // GET /books -> get all books
//     app.get("/books", async (req, res) => {
//       const result = await booksCollection.find().toArray();
//       res.send(result);
//     });

//     // GET /books/:id -> get book by ID
//     app.get("/books/:id", async (req, res) => {
//       const id = req.params.id;

//       if (!ObjectId.isValid(id)) {
//         return res.status(400).send({ error: "Invalid ID" });
//       }

//       const result = await booksCollection.findOne({ _id: new ObjectId(id) });
//       if (!result) {
//         return res.status(404).send({ error: "Book not found" });
//       }

//       res.send(result);
//     });
//   } catch (err) {
//     console.error(err);
//   }
// }


//  // Payment endpoints
//     app.post('/create-checkout-session', async (req, res) => {
//       const paymentInfo = req.body
//       console.log(paymentInfo)
//       const session = await stripe.checkout.sessions.create({
//         line_items: [
//           {
//             price_data: {
//               currency: 'usd',
//               product_data: {
//                 name: paymentInfo?.name,
//                 description: paymentInfo?.description,
//                 images: [paymentInfo.image],
//               },
//               unit_amount: paymentInfo?.price * 100,
//             },
//             quantity: paymentInfo?.quantity,
//           },
//         ],
//         customer_email: paymentInfo?.customer?.email,
//         mode: 'payment',
//         metadata: {
//           bookId: paymentInfo?.bookId,
//           customer: paymentInfo?.customer.email,
//         },
//         success_url: `http://localhost:5173/payment-success?session_id={CHECKOUT_SESSION_ID}`,
//         cancel_url: `http://localhost:5173/book/${paymentInfo?.bookId}`,
//       })
//       res.send({ url: session.url })
//     })

// run().catch(console.dir);

// // Test route
// app.get("/", (req, res) => {
//   res.send("Hello from Server..");
// });

// // Start server
// app.listen(port, () => {
//   console.log(`Server is running on port ${port}`);
// });
