const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
// require('dotenv').config();
const corsOptions = {
  origin: 'http://localhost:3000', // or ['http://localhost:3000', 'your-prod-frontend-url']
  credentials: true,              // if you're using cookies/auth headers
};
const app = express();
app.use(cors({
  origin: ['http://localhost:3000', 'https://www.ptu-examresult.in'],
  credentials: true,
}));app.use(express.json());


// MongoDB connection
const connectionUrl = "mongodb+srv://sefrdboy:GWEmLHnBwE4XGCRc@cluster0.gixibq3.mongodb.net/test?retryWrites=true&w=majority&appName=Cluster0";
const PORT = process.env.PORT || 5000;

mongoose.connect(connectionUrl, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,  // Set a higher timeout
  connectTimeoutMS: 30000,   
})
.then(async () => {
  console.log('Connected to MongoDB');
  await initializePassword(); // Moved inside .then after DB connection
})
.catch((err) => console.error('MongoDB connection error:', err));

const bcrypt = require('bcrypt');
const passwordSchema = new mongoose.Schema({
  hash: String,
});
const AdminPassword = mongoose.model("AdminPassword", passwordSchema);

async function initializePassword() {
  const existing = await AdminPassword.findOne();
  if (!existing) {
    const hash = await bcrypt.hash("admin123", 10); // default password
    await new AdminPassword({ hash }).save();
    console.log("Default admin password set.");
  }
}
initializePassword();
// Define the Result Schema
const resultSchema = new mongoose.Schema({
  rollNumber: String,
  semester: String,
  year: String,
  courseStream: String,
  fileName: String,
  uploadedAt: { type: Date, default: Date.now },
});

const Result = mongoose.model('Result', resultSchema);

// Define the Course Schema
const courseSchema = new mongoose.Schema({
  name: String, // e.g., 'BTech', 'MTech', 'MBA'
  years: [Number], // e.g., [1, 2, 3, 4] for BTech
  semesters: [String], // e.g., ['Semester 1', 'Semester 2'] for BTech
  streams: [String], // e.g., ['CSE', 'ECE'] for BTech
});

const Course = mongoose.model('Course', courseSchema);

// Ensure the uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });


app.post('/admin/change-password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const stored = await AdminPassword.findOne();
  if (!stored) return res.status(500).json({ message: "Admin password not set." });

  const valid = await bcrypt.compare(oldPassword, stored.hash);
  if (!valid) return res.status(403).json({ message: "Old password incorrect" });

  const newHash = await bcrypt.hash(newPassword, 10);
  stored.hash = newHash;
  await stored.save();

  res.json({ message: "Password changed successfully" });
});

// Route to upload result file
app.post('/upload', upload.single('file'), async (req, res) => {
  const { rollNumber, semester, year, course, stream } = req.body;
  const fileName = req.file?.filename;

  try {
    if (!fileName || !rollNumber || !year || !course || !stream) {
      return res.status(400).json({ message: 'Missing required fields or file.' });
    }

    const courseStream = `${course}-${stream}`;
    const resultData = { rollNumber, year, courseStream, fileName };

    if (semester) {
      resultData.semester = semester;
    }

    const newResult = new Result(resultData);   
     await newResult.save();

    res.json({ message: 'File uploaded and stored in MongoDB.', fileName });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Upload failed.' });
  }
});


// Route to download result file

app.get('/download', async (req, res) => {
  const { rollNumber, semester, year, branch, stream } = req.query;

  // Basic validation
  if (!rollNumber || !year) {
    return res.status(400).send('Missing required parameters: rollNumber and year are required.');
  }

  try {
    const query = { rollNumber, year };

    if (semester) {
      query.semester = semester;
    }

    if (branch) {
      query.branch = branch;
    }

    if (stream) {
      query.stream = stream;
    }

    const result = await Result.findOne(query);

    if (!result) {
      console.warn(`Result not found for: ${JSON.stringify(query)}`);
      return res.status(404).send('Result not found.');
    }

    const filePath = path.join(uploadDir, result.fileName);
    res.download(filePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        res.status(500).send('Error downloading the file.');
      }
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).send('Internal server error.');
  }
});

// Route to filter results based on year, semester, course, and stream
app.get('/filter', async (req, res) => {
  const { year, semester, course, stream } = req.query;
  const query = {};

  // Build the query based on the parameters
  if (year) query.year = year;
  if (semester) query.semester = semester;
  if (course && stream) {
    query.courseStream = `${course}-${stream}`;  // Ensure format is correct (e.g., "b.tech-IT")
  }

  try {
    const results = await Result.find(query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching filtered results', error });
  }
});


// Route to get all course configurations
app.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find();
    res.json(courses);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching course configurations.' });
  }
});

// Route to save new course configurations
app.post('/course', async (req, res) => {
  const { name, years, semesters, streams } = req.body;

  if (!name || !years || !streams) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  try {
    const existingCourse = await Course.findOne({ name });
    if (existingCourse) {
      return res.status(200).json({ message: "Course already exists." });
    }

    const cleanedSemesters = Array.isArray(semesters)
      ? semesters.filter(s => s && s.trim() !== "")
      : [];

    const newCourse = new Course({
      name,
      years,
      semesters: cleanedSemesters,
      streams
    });

    await newCourse.save();
    res.status(201).json({ message: "Course saved successfully." });

  } catch (error) {
    console.error("Error saving course:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});


// Route to delete a course configuration
app.delete('/courses/:id', async (req, res) => {
  try {
    await Course.findByIdAndDelete(req.params.id);  // Correct model usage
    res.json({ message: 'Course deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting course', error });
  }
});




app.post('/admin/login', async (req, res) => {
  const { password } = req.body;
  const stored = await AdminPassword.findOne();

  if (!stored) return res.status(500).json({ message: "Admin password not set." });

  const valid = await bcrypt.compare(password, stored.hash);
  if (valid) {
    res.json({ success: true });
  } else {
    res.status(401).json({ message: "Incorrect password" });
  }
});
app.post('/admin/change-password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const stored = await AdminPassword.findOne();
  if (!stored) return res.status(500).json({ message: "Admin password not set." });

  const valid = await bcrypt.compare(oldPassword, stored.hash);
  if (!valid) return res.status(403).json({ message: "Old password incorrect" });

  const newHash = await bcrypt.hash(newPassword, 10);
  stored.hash = newHash;
  await stored.save();

  res.json({ message: "Password changed successfully" });
});

// Route to get course and stream by roll number
app.get('/student-info', async (req, res) => {
  const { rollNumber } = req.query;

  if (!rollNumber) {
    return res.status(400).json({ message: "Roll number is required." });
  }

  try {
    // Fetch the latest result entry for that roll number
    const result = await Result.findOne({ rollNumber }).sort({ uploadedAt: -1 });

    if (!result) {
      return res.status(404).json({ message: "No data found for this roll number." });
    }

    // Split courseStream back into course and stream
    const [course, stream] = result.courseStream.split('-');

    res.json({ course, stream });
  } catch (error) {
    console.error("Error fetching student info:", error);
    res.status(500).json({ message: "Server error retrieving student info." });
  }
});


app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
