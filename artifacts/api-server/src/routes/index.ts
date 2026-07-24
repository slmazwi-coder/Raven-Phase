import { Router, type IRouter } from "express";
import healthRouter from "./health";
import enrollRouter from "./enroll";
import adminRouter from "./admin";
import groupsRouter from "./groups";
import incidentsRouter from "./incidents";
import devicesRouter from "./devices";

const router: IRouter = Router();

router.use(healthRouter);
router.use(enrollRouter);
router.use(adminRouter);
router.use(groupsRouter);
router.use(incidentsRouter);
router.use(devicesRouter);

export default router;
