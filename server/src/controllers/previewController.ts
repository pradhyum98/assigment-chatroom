import { Response, NextFunction } from 'express';
import { z } from 'zod';
import dns from 'dns';
import { promisify } from 'util';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';

const resolveDns = promisify(dns.lookup);

const previewSchema = z.object({
  url: z.string().url('Invalid URL'),
});

function isPrivateIP(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;

  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 127.0.0.0/8 (Loopback)
  if (parts[0] === 127) return true;
  // 169.254.0.0/16 (Link-local)
  if (parts[0] === 169 && parts[1] === 254) return true;

  return false;
}

export const getLinkPreview = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { success, data } = previewSchema.safeParse(req.query);
    if (!success) {
      throw new AppError('A valid URL is required', 400);
    }

    const targetUrl = new URL(data.url);

    // Only allow HTTP/HTTPS
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      throw new AppError('Only HTTP/HTTPS URLs are supported', 400);
    }

    // SSRF Prevention: Resolve hostname and check IP
    const lookupResult = await resolveDns(targetUrl.hostname);
    if (isPrivateIP(lookupResult.address)) {
      throw new AppError('Access to private IP addresses is blocked', 403);
    }

    // Fetch the URL with a timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(targetUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ChatRoom-Link-Preview-Bot/1.0',
      },
    });

    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      res.status(200).json({
        success: true,
        data: {
          title: targetUrl.hostname,
          description: '',
          image: '',
          url: data.url,
        },
      });
      return;
    }

    // Read only the first 50KB to prevent memory exhaustion DoS
    const reader = response.body?.getReader();
    let html = '';
    let bytesRead = 0;

    if (reader) {
      while (bytesRead < 50000) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          bytesRead += value.length;
          html += new TextDecoder().decode(value);
        }
      }
    }

    // Very naive extraction using regex
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i) || 
                      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
                         html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);

    const title = titleMatch ? titleMatch[1].trim() : targetUrl.hostname;
    const description = descMatch ? descMatch[1].trim() : '';
    const image = ogImageMatch ? ogImageMatch[1].trim() : '';

    res.status(200).json({
      success: true,
      data: {
        title,
        description,
        image,
        url: data.url,
      },
    });
  } catch (error: any) {
    if (error.name === 'AbortError') {
      next(new AppError('Request timeout', 408));
    } else {
      next(new AppError('Failed to generate preview', 500));
    }
  }
};
