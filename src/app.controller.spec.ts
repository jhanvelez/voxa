import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('twiml', () => {
    it('should return TwiML response', () => {
      const mockResponse = {
        type: jest.fn(),
        send: jest.fn(),
      };

      appController.getTwiml(mockResponse as any);

      expect(mockResponse.type).toHaveBeenCalledWith('text/xml');
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('<Response>'),
      );
    });
  });
});
