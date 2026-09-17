<?php
// XferFlow - InfinityFree PHP Polling Signaling Server
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Cache-Control: post-check=0, pre-check=0", false);
header("Pragma: no-cache");

$sessionsDir = __DIR__ . '/sessions/';
$radarFile = $sessionsDir . 'radar.json';
$otpsFile = $sessionsDir . 'otps.json';

// Ensure sessions directory exists
if (!is_dir($sessionsDir)) {
    mkdir($sessionsDir, 0777, true);
}

$now = time();

// Clean up old sessions and radar entries (older than 2 minutes)
$files = glob($sessionsDir . '*.jsonl');
foreach ($files as $file) {
    if (is_file($file) && ($now - filemtime($file) > 120)) {
        unlink($file);
    }
}

// Atomic helper function for read-modify-write on JSON files
function atomicModifyJson($file, $callback) {
    if (!file_exists($file)) {
        file_put_contents($file, "[]");
    }
    $fp = fopen($file, 'c+');
    if (!$fp) return false;
    
    if (flock($fp, LOCK_EX)) {
        $filesize = filesize($file);
        $json = $filesize > 0 ? fread($fp, $filesize) : '';
        $data = json_decode($json, true) ?: [];
        
        $newData = $callback($data);
        
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($newData));
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        return true;
    }
    fclose($fp);
    return false;
}

function getClientIp() {
    $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
    if (strpos($ip, ',') !== false) {
        $ips = explode(',', $ip);
        $ip = trim($ips[0]);
    }
    return $ip;
}

// Read raw POST data
$input = file_get_contents('php://input');
$request = json_decode($input, true);

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $request) {
    $type = $request['type'] ?? '';
    
    // Handle Radar
    if ($type === 'radar-join' || $type === 'radar-leave') {
        $ip = getClientIp();
        $radarId = $request['radarId'] ?? '';
        $deviceName = $request['deviceName'] ?? 'XferFlow User';

        atomicModifyJson($radarFile, function($radarData) use ($type, $ip, $radarId, $deviceName, $now) {
            // Clean old
            $radarData = array_filter($radarData, function($entry) use ($now) {
                return ($now - $entry['timestamp']) < 60;
            });

            // Remove existing entry for this ID
            $radarData = array_filter($radarData, function($entry) use ($radarId) {
                return $entry['radarId'] !== $radarId;
            });

            if ($type === 'radar-join') {
                $radarData[] = [
                    'ip' => $ip,
                    'radarId' => $radarId ? $radarId : uniqid(),
                    'deviceName' => $deviceName,
                    'timestamp' => $now
                ];
            }
            return array_values($radarData);
        });

        echo json_encode(["status" => "ok"]);
        exit;
    }

    // Handle OTP Generation
    if ($type === 'generate-otp') {
        $sessionId = $request['sessionId'] ?? '';
        if (!$sessionId) { echo json_encode(["error" => "No sessionId"]); exit; }

        $generatedCode = null;
        
        atomicModifyJson($otpsFile, function($otpsData) use ($sessionId, $now, &$generatedCode) {
            // Clean old
            $otpsData = array_filter($otpsData, function($entry) use ($now) {
                return ($now - $entry['timestamp']) < 300;
            });

            $usedCodes = array_keys($otpsData);
            do {
                $code = (string)random_int(1000, 9999);
            } while (in_array($code, $usedCodes));
            
            $generatedCode = $code;
            
            $otpsData[$code] = [
                'sessionId' => $sessionId,
                'timestamp' => $now
            ];
            return $otpsData;
        });

        echo json_encode(["otp" => $generatedCode]);
        exit;
    }

    // Handle OTP Claim
    if ($type === 'claim-otp') {
        $code = $request['code'] ?? '';
        $foundSessionId = null;

        atomicModifyJson($otpsFile, function($otpsData) use ($code, $now, &$foundSessionId) {
            // Clean old
            $otpsData = array_filter($otpsData, function($entry) use ($now) {
                return ($now - $entry['timestamp']) < 300;
            });

            if (isset($otpsData[$code])) {
                $foundSessionId = $otpsData[$code]['sessionId'];
                unset($otpsData[$code]);
            }
            return $otpsData;
        });

        if ($foundSessionId) {
            echo json_encode(["status" => "ok", "sessionId" => $foundSessionId]);
        } else {
            echo json_encode(["error" => "Invalid or expired code"]);
        }
        exit;
    }

    // Handle Session Messaging
    $sessionId = $request['sessionId'] ?? '';
    if (!$sessionId) {
        echo json_encode(["error" => "No sessionId provided"]);
        exit;
    }

    // Sanitize session ID
    $sessionId = preg_replace('/[^a-zA-Z0-9_-]/', '', $sessionId);
    $sessionFile = $sessionsDir . $sessionId . '.jsonl';

    // If leave, clean up zero-retention (connected relies on the 2-minute auto-expiry to avoid race conditions)
    if ($type === 'leave') {
        if (file_exists($sessionFile)) {
            unlink($sessionFile);
        }
        echo json_encode(["status" => "purged"]);
        exit;
    }
    
    // Add timestamp and unique message ID to avoid processing duplicates
    $request['msgId'] = uniqid();
    $request['timestamp'] = $now;

    // Append to file
    file_put_contents($sessionFile, json_encode($request) . PHP_EOL, FILE_APPEND | LOCK_EX);
    
    echo json_encode(["status" => "sent"]);
    exit;
}

// Handle GET requests (Polling)
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? '';
    
    if ($action === 'radar') {
        $myRadarId = $_GET['radarId'] ?? '';
        $ip = getClientIp();
        
        $peersList = [];
        atomicModifyJson($radarFile, function($radarData) use ($myRadarId, $ip, $now, &$peersList) {
            // Clean up and read at the same time
            $radarData = array_filter($radarData, function($entry) use ($now) {
                return ($now - $entry['timestamp']) < 60;
            });
            
            $peers = array_filter($radarData, function($entry) use ($myRadarId) {
                return $entry['radarId'] !== $myRadarId;
            });
            
            $peersList = array_values(array_map(function($p) {
                return ["radarId" => $p['radarId'], "deviceName" => $p['deviceName']];
            }, $peers));
            
            return array_values($radarData);
        });
        
        echo json_encode(["type" => "radar-update", "peers" => $peersList]);
        exit;
    }
    
    if ($action === 'poll') {
        $sessionId = $_GET['sessionId'] ?? '';
        $lastMsgId = $_GET['lastMsgId'] ?? '';
        
        if (!$sessionId) {
            echo json_encode(["error" => "No sessionId provided"]);
            exit;
        }

        $sessionId = preg_replace('/[^a-zA-Z0-9_-]/', '', $sessionId);
        $sessionFile = $sessionsDir . $sessionId . '.jsonl';

        $messages = [];
        if (file_exists($sessionFile)) {
            // file() is atomic enough for reading lines, especially since writing uses LOCK_EX | FILE_APPEND
            $lines = file($sessionFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            $foundLast = ($lastMsgId === ''); // If no lastMsgId, send all
            
            foreach ($lines as $line) {
                $msg = json_decode($line, true);
                if ($msg) {
                    if ($foundLast) {
                        $messages[] = $msg;
                    } else if ($msg['msgId'] === $lastMsgId) {
                        $foundLast = true; // Start taking messages after this one
                    }
                }
            }
        }
        
        echo json_encode(["messages" => $messages]);
        exit;
    }
}
?>
