import { prisma } from './prisma';
import { Job, Task, ErrorLog } from '../../generated/prisma/client';
import { createEnhancedLogger } from '../../utils/logger';

const logger = createEnhancedLogger('JobRepo');

export class JobRepository {
  /**
   * Create a new job record
   */
  static async createJob(data: {
    bullJobId?: string;
    type: string;
    config: any;
    priority?: number;
  }): Promise<Job> {
    try {
      return await prisma.job.create({
        data: {
          bullJobId: data.bullJobId,
          type: data.type,
          config: data.config,
          priority: data.priority || 0,
          status: 'pending',
        },
      });
    } catch (error: any) {
      logger.error('Failed to create job', error);
      throw error;
    }
  }

  /**
   * Update job status
   */
  static async updateStatus(
    id: string,
    status: string,
    error?: string
  ): Promise<Job> {
    return prisma.job.update({
      where: { id },
      data: {
        status,
        error,
        startedAt: status === 'active' ? new Date() : undefined,
        completedAt: ['completed', 'failed'].includes(status) ? new Date() : undefined,
      },
    });
  }

  /**
   * Find job by BullMQ ID
   */
  static async findByBullId(bullJobId: string): Promise<Job | null> {
    return prisma.job.findFirst({
      where: { bullJobId },
    });
  }

  /**
   * Update BullMQ job ID after queue submission
   */
  static async updateBullJobId(id: string, bullJobId: string): Promise<Job> {
    return prisma.job.update({
      where: { id },
      data: { bullJobId },
    });
  }

  /**
   * Create a task for a job (e.g. a date chunk)
   */
  static async createTask(data: {
    jobId: string;
    type: string;
    config: any;
  }): Promise<Task> {
    return prisma.task.create({
      data: {
        jobId: data.jobId,
        type: data.type,
        config: data.config,
        status: 'pending',
      },
    });
  }

  /**
   * Update task status
   */
  static async updateTaskStatus(
    id: string,
    status: string,
    result?: any,
    error?: string
  ): Promise<Task> {
    return prisma.task.update({
      where: { id },
      data: {
        status,
        result,
        error,
        startedAt: status === 'active' ? new Date() : undefined,
        completedAt: ['completed', 'failed'].includes(status) ? new Date() : undefined,
      },
    });
  }

  /**
   * Log an error
   */
  static async logError(data: {
    jobId?: string;
    severity: 'fatal' | 'error' | 'warn';
    category: string;
    message: string;
    stack?: string;
    context?: any;
  }): Promise<ErrorLog> {
    return prisma.errorLog.create({
      data: {
        jobId: data.jobId,
        severity: data.severity,
        category: data.category,
        message: data.message,
        stack: data.stack,
        context: data.context,
      },
    });
  }
}
