import jwt from 'jsonwebtoken';
import "dotenv/config";

export const authenticate = (req, res, next) => {
    // Check if cookie exists and has a token
    console.log("Cookies received:", req.cookies);

    if (!req.cookies || !req.cookies.token) {
        return res.status(401).send({ message: 'You are not logged in - token missing' });
    }

    try {
        let data = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
        req.user = data;
        next();
    } catch (err) {
        return res.status(400).send({ message: 'Something went wrong' });
    }
};