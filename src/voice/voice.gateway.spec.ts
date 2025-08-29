import { Test, TestingModule } from '@nestjs/testing';
import { VoiceGateway } from './voice.gateway';

describe('VoiceGateway', () => {
  let gateway: VoiceGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VoiceGateway],
    }).compile();

    gateway = module.get<VoiceGateway>(VoiceGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
