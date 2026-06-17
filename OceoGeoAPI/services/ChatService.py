## chat service 

class ChatService:
    def __init__(self):
        self.message = None
    def process_message(self, message):
        self.message = message
        return {self.message}