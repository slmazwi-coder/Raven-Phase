import jwt from "jsonwebtoken";

const [,, sub, role] = process.argv;
if (!sub || !role) { console.error("Usage: sign-token <sub> <role>"); process.exit(1); }
if (!process.env.SESSION_SECRET) { console.error("SESSION_SECRET not set"); process.exit(1); }
const token = jwt.sign({ sub, role }, process.env.SESSION_SECRET, { expiresIn: "30d" });
console.log(token);
