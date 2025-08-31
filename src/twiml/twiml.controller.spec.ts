import { Test, TestingModule } from '@nestjs/testing';
import { TwimlController } from './twiml.controller';

describe('TwimlController', () => {
  let controller: TwimlController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TwimlController],
    }).compile();

    controller = module.get<TwimlController>(TwimlController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
