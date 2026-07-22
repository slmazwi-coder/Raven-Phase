import { Router, type IRouter } from "express";
import healthRouter from "./health";
import enrollRouter from "./enroll";
import adminRouter from "./admin";
import groupsRouter from "./groups";

const router: IRouter = Router();

router.use(healthRouter);
router.use(enrollRouter);
router.use(adminRouter);
router.use(groupsRouter);

export default router;
