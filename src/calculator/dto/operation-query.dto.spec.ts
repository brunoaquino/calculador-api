import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { OperationQueryDto } from './operation-query.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

function transformQuery(query: Record<string, unknown>): Promise<OperationQueryDto> {
  return pipe.transform(query, {
    type: 'query',
    metatype: OperationQueryDto,
    data: '',
  });
}

async function validationMessages(query: Record<string, unknown>): Promise<string[]> {
  try {
    await transformQuery(query);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BadRequestException);
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    const body: unknown = error.getResponse();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = body.message;
      return Array.isArray(message) ? message.map(String) : [String(message)];
    }
  }

  throw new Error('expected validation to fail');
}

describe('OperationQueryDto', () => {
  it('transforms finite decimal strings into numbers', async () => {
    await expect(transformQuery({ term_one: '4', term_two: '1' })).resolves.toEqual({
      term_one: 4,
      term_two: 1,
    });
    await expect(transformQuery({ term_one: '0', term_two: '-3' })).resolves.toEqual({
      term_one: 0,
      term_two: -3,
    });
    await expect(transformQuery({ term_one: '1e2', term_two: '2.5' })).resolves.toEqual({
      term_one: 100,
      term_two: 2.5,
    });
  });

  it('requires both operands', async () => {
    await expect(validationMessages({})).resolves.toEqual([
      'term_one is required',
      'term_two is required',
    ]);
    await expect(validationMessages({ term_one: '', term_two: '1' })).resolves.toEqual([
      'term_one is required',
    ]);
  });

  it('rejects values that are not finite decimals', async () => {
    await expect(validationMessages({ term_one: 'abc', term_two: '1' })).resolves.toEqual([
      'term_one must be a finite decimal number',
    ]);
    await expect(validationMessages({ term_one: ' ', term_two: '0x10' })).resolves.toEqual([
      'term_one must be a finite decimal number',
      'term_two must be a finite decimal number',
    ]);
    await expect(validationMessages({ term_one: '1e400', term_two: 'Infinity' })).resolves.toEqual([
      'term_one must be a finite decimal number',
      'term_two must be a finite decimal number',
    ]);
  });

  it('rejects unexpected query parameters', async () => {
    await expect(
      validationMessages({ term_one: '1', term_two: '2', extra: 'no' }),
    ).resolves.toEqual(['property extra should not exist']);
  });
});
